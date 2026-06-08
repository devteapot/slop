#if canImport(Darwin)
import Darwin
import Foundation

public final class UnixSocketProviderTransport {
  private let server: SlopServer
  private let path: String
  private let acceptQueue = DispatchQueue(label: "dev.slop.unix-socket-provider.accept", qos: .utility)
  private var listenerFD: Int32 = -1
  private var isRunning = false
  private var discoveryDirectory: URL?

  public init(server: SlopServer, path: String) {
    self.server = server
    self.path = path
  }

  public func start(discover: Bool = false, discoveryDirectory: URL = Discovery.defaultProviderDirectories[0]) throws {
    guard !isRunning else { return }
    try FileManager.default.createDirectory(
      at: URL(fileURLWithPath: path).deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    Darwin.unlink(path)
    let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else {
      throw SlopError.internalError("Unix provider socket create failed: \(unixErrnoDescription())")
    }

    do {
      try bindAndListen(fd: fd)
    } catch {
      Darwin.close(fd)
      throw error
    }

    listenerFD = fd
    isRunning = true
    _ = Darwin.chmod(path, 0o600)

    if discover {
      try Discovery.registerUnixProvider(
        id: server.id,
        name: server.name,
        socketPath: path,
        directory: discoveryDirectory
      )
      self.discoveryDirectory = discoveryDirectory
    }

    acceptQueue.async { [weak self] in
      self?.acceptLoop()
    }
  }

  public func stop() {
    guard isRunning else { return }
    isRunning = false
    let fd = listenerFD
    listenerFD = -1
    if fd >= 0 {
      Darwin.shutdown(fd, SHUT_RDWR)
      Darwin.close(fd)
    }
    Darwin.unlink(path)
    if let discoveryDirectory {
      Discovery.unregisterProvider(id: server.id, directory: discoveryDirectory)
      self.discoveryDirectory = nil
    }
  }

  deinit {
    stop()
  }

  private func bindAndListen(fd: Int32) throws {
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
    guard Darwin.listen(fd, SOMAXCONN) == 0 else {
      throw SlopError.internalError("Unix provider socket listen failed at \(path): \(unixErrnoDescription())")
    }
  }

  private func acceptLoop() {
    while isRunning {
      let fd = Darwin.accept(listenerFD, nil, nil)
      if fd < 0 {
        if isRunning {
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
