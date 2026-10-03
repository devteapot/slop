#if canImport(Darwin)
import Darwin
import Foundation

private struct UnixSocketFileIdentity: Equatable {
  var device: UInt64
  var inode: UInt64
}

public final class UnixSocketProviderTransport {
  private let server: SlopServer
  private let path: String
  private let acceptQueue = DispatchQueue(label: "dev.slop.unix-socket-provider.accept", qos: .utility)
  private let stateLock = NSLock()
  private let beforeQuarantineInspection: (() -> Void)?
  private var listenerFD: Int32 = -1
  private var isRunning = false
  private var discoveryRegistration: ProviderRegistration?
  private var socketIdentity: UnixSocketFileIdentity?

  public init(server: SlopServer, path: String) {
    self.server = server
    self.path = path
    beforeQuarantineInspection = nil
  }

  init(server: SlopServer, path: String, beforeQuarantineInspection: @escaping () -> Void) {
    self.server = server
    self.path = path
    self.beforeQuarantineInspection = beforeQuarantineInspection
  }

  public func start(discover: Bool = false, discoveryDirectory: URL = Discovery.defaultProviderDirectories[0]) throws {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard !isRunning else { return }
    let parentDirectory = URL(fileURLWithPath: path).deletingLastPathComponent()
    try FileManager.default.createDirectory(at: parentDirectory, withIntermediateDirectories: true)
    try validateSocketParentDirectory(parentDirectory)

    try requireAbsentSocketPath()
    let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else {
      throw SlopError.internalError("Unix provider socket create failed: \(unixErrnoDescription())")
    }

    var createdIdentity: UnixSocketFileIdentity?
    var discoveryRegistration: ProviderRegistration?
    do {
      try bindAndListen(fd: fd, identity: &createdIdentity)
      guard Darwin.chmod(path, 0o600) == 0 else {
        throw SlopError.internalError("Unix provider socket permission hardening failed at \(path): \(unixErrnoDescription())")
      }
      guard let createdIdentity, try socketIdentityAtPath() == createdIdentity else {
        throw SlopError.internalError("Unix provider socket path was replaced during startup at \(path)")
      }
      if discover {
        discoveryRegistration = try Discovery.registerUnixProvider(
          id: server.id,
          name: server.name,
          socketPath: path,
          directory: discoveryDirectory
        )
      }
    } catch {
      Darwin.close(fd)
      if let createdIdentity {
        unlinkSocketIfMatches(createdIdentity)
      }
      throw error
    }

    listenerFD = fd
    isRunning = true
    socketIdentity = createdIdentity
    self.discoveryRegistration = discoveryRegistration

    acceptQueue.async { [weak self] in
      self?.acceptLoop()
    }
  }

  public func stop() {
    stateLock.lock()
    guard isRunning else {
      stateLock.unlock()
      return
    }
    isRunning = false
    let fd = listenerFD
    listenerFD = -1
    let discoveryRegistration = self.discoveryRegistration
    self.discoveryRegistration = nil
    let socketIdentity = self.socketIdentity
    self.socketIdentity = nil
    stateLock.unlock()
    if fd >= 0 {
      Darwin.shutdown(fd, SHUT_RDWR)
      Darwin.close(fd)
    }
    if let socketIdentity {
      unlinkSocketIfMatches(socketIdentity)
    }
    if let discoveryRegistration {
      Discovery.unregisterProvider(discoveryRegistration)
    }
  }

  deinit {
    stop()
  }

  private func bindAndListen(fd: Int32, identity: inout UnixSocketFileIdentity?) throws {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)

    let pathBytes = Array(path.utf8) + [0]
    let maxPathLength = MemoryLayout.size(ofValue: address.sun_path)
    guard pathBytes.count <= maxPathLength else {
      throw SlopError.internalError("Unix provider socket path is too long: \(path)")
    }

    withUnsafeMutableBytes(of: &address.sun_path) { rawBuffer in
      rawBuffer.copyBytes(from: pathBytes)
    }

    let bindResult = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
        Darwin.bind(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }

    guard bindResult == 0 else {
      throw SlopError.internalError("Unix provider socket bind failed at \(path): \(unixErrnoDescription())")
    }
    identity = try socketIdentityAtPath()
    guard Darwin.listen(fd, SOMAXCONN) == 0 else {
      throw SlopError.internalError("Unix provider socket listen failed at \(path): \(unixErrnoDescription())")
    }
  }

  private func requireAbsentSocketPath() throws {
    var statBuffer = stat()
    if Darwin.lstat(path, &statBuffer) != 0 {
      guard errno == ENOENT else {
        throw SlopError.internalError("Could not inspect existing Unix provider socket path at \(path): \(unixErrnoDescription())")
      }
      return
    }
    throw SlopError.internalError("Refusing to replace an existing file at Unix provider socket path \(path)")
  }

  private func socketIdentityAtPath() throws -> UnixSocketFileIdentity {
    try socketIdentity(at: path)
  }

  private func socketIdentity(at candidatePath: String) throws -> UnixSocketFileIdentity {
    var statBuffer = stat()
    guard Darwin.lstat(candidatePath, &statBuffer) == 0 else {
      throw SlopError.internalError("Could not inspect Unix provider socket at \(candidatePath): \(unixErrnoDescription())")
    }
    let mode = Int(statBuffer.st_mode)
    guard (mode & Int(S_IFMT)) == Int(S_IFSOCK), statBuffer.st_uid == Darwin.getuid() else {
      throw SlopError.internalError("Unix provider socket path is not an owned socket at \(candidatePath)")
    }
    return UnixSocketFileIdentity(device: UInt64(statBuffer.st_dev), inode: UInt64(statBuffer.st_ino))
  }

  private func fileIdentity(at candidatePath: String) -> UnixSocketFileIdentity? {
    var statBuffer = stat()
    guard Darwin.lstat(candidatePath, &statBuffer) == 0 else { return nil }
    return UnixSocketFileIdentity(device: UInt64(statBuffer.st_dev), inode: UInt64(statBuffer.st_ino))
  }

  private func unlinkSocketIfMatches(_ identity: UnixSocketFileIdentity) {
    let quarantine = "\(path).slop-remove-\(UUID().uuidString)"
    guard Darwin.rename(path, quarantine) == 0 else { return }
    beforeQuarantineInspection?()
    guard let movedIdentity = fileIdentity(at: quarantine) else { return }
    if movedIdentity == identity {
      Darwin.unlink(quarantine)
      return
    }
    if Darwin.link(quarantine, path) == 0 {
      Darwin.unlink(quarantine)
    } else if errno == EEXIST {
      Darwin.unlink(quarantine)
    }
  }

  private func validateSocketParentDirectory(_ directory: URL) throws {
    let fd = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard fd >= 0 else {
      throw SlopError.internalError("Could not safely open Unix provider socket directory at \(directory.path)")
    }
    defer { Darwin.close(fd) }

    var statBuffer = stat()
    guard Darwin.fstat(fd, &statBuffer) == 0 else {
      throw SlopError.internalError("Could not inspect Unix provider socket directory at \(directory.path)")
    }
    let mode = Int(statBuffer.st_mode)
    guard (mode & Int(S_IFMT)) == Int(S_IFDIR), statBuffer.st_uid == Darwin.getuid() else {
      throw SlopError.internalError("Unix provider socket directory must be an owned real directory at \(directory.path)")
    }
    guard mode & 0o022 == 0 else {
      throw SlopError.internalError("Unix provider socket directory must not be group- or world-writable at \(directory.path)")
    }
  }

  private func acceptLoop() {
    while true {
      stateLock.lock()
      let listenerFD = isRunning ? self.listenerFD : -1
      stateLock.unlock()
      guard listenerFD >= 0 else { return }

      let fd = Darwin.accept(listenerFD, nil, nil)
      if fd < 0 {
        stateLock.lock()
        let shouldContinue = isRunning
        stateLock.unlock()
        if shouldContinue {
          continue
        }
        return
      }

      let connection = UnixSocketConnection(fileDescriptor: fd)
      server.attachConnection(connection)
      connection.startReading()
    }
  }
}

extension SlopServer {
  @discardableResult
  public func listenUnix(
    path: String,
    discover: Bool = false,
    discoveryDirectory: URL = Discovery.defaultProviderDirectories[0]
  ) throws -> UnixSocketProviderTransport {
    let transport = UnixSocketProviderTransport(server: self, path: path)
    try transport.start(discover: discover, discoveryDirectory: discoveryDirectory)
    return transport
  }
}
#endif
