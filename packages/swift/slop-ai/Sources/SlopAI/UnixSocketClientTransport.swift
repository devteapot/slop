#if canImport(Darwin)
import Darwin
import Foundation

public final class UnixSocketClientTransport: ClientTransport {
  private let path: String

  public init(path: String) {
    self.path = path
  }

  public func connect() async throws -> SlopConnection {
    let fd = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else {
      throw SlopError.internalError("Unix socket create failed: \(unixErrnoDescription())")
    }

    do {
      try connect(fd: fd, path: path)
    } catch {
      Darwin.close(fd)
      throw error
    }

    let connection = UnixSocketConnection(fileDescriptor: fd)
    connection.startReading()
    return connection
  }

  private func connect(fd: Int32, path: String) throws {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)

    let pathBytes = Array(path.utf8) + [0]
    let maxPathLength = MemoryLayout.size(ofValue: address.sun_path)
    guard pathBytes.count <= maxPathLength else {
      throw SlopError.internalError("Unix socket path is too long: \(path)")
    }

    withUnsafeMutableBytes(of: &address.sun_path) { rawBuffer in
      rawBuffer.copyBytes(from: pathBytes)
    }

    let result = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
        Darwin.connect(fd, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }

    guard result == 0 else {
      throw SlopError.internalError("Unix socket connect failed at \(path): \(unixErrnoDescription())")
    }
  }
}

public final class UnixSocketConnection: SlopConnection {
  private let fd: Int32
  private let lock = NSLock()
  private let ioLock = NSLock()
  private let writeQueue = DispatchQueue(label: "dev.slop.unix-socket.write")
  private var messageHandlers: [(SlopMessage) -> Void] = []
  private var closeHandlers: [() -> Void] = []
  private var pendingMessages: [SlopMessage] = []
  private var didClose = false

  init(fileDescriptor: Int32) {
    fd = fileDescriptor
  }

  public func send(_ message: SlopMessage) {
    writeQueue.async { [weak self] in
      guard let self else { return }
      do {
        var data = try JSONEncoder().encode(JSONValue.object(message))
        data.append(0x0A)
        try self.writeAll(data)
      } catch {
        self.fireClose()
      }
    }
  }

  public func onMessage(_ handler: @escaping (SlopMessage) -> Void) {
    lock.lock()
    messageHandlers.append(handler)
    let pending = pendingMessages
    pendingMessages.removeAll()
    lock.unlock()

    for message in pending {
      handler(message)
    }
  }

  public func onClose(_ handler: @escaping () -> Void) {
    lock.lock()
    let alreadyClosed = didClose
    if !alreadyClosed {
      closeHandlers.append(handler)
    }
    lock.unlock()
    if alreadyClosed {
      handler()
    }
  }

  public func close() {
    fireClose()
  }

  func startReading() {
    DispatchQueue.global(qos: .utility).async { [weak self] in
      self?.readLoop()
    }
  }

  private func readLoop() {
    var pending = Data()
    var buffer = [UInt8](repeating: 0, count: 4096)

    while !isClosed {
      let count = Darwin.read(fd, &buffer, buffer.count)
      if count <= 0 {
        break
      }
      pending.append(buffer, count: count)

      while let newline = pending.firstIndex(of: 0x0A) {
        let line = pending[..<newline]
        pending.removeSubrange(pending.startIndex...newline)
        guard !line.isEmpty else { continue }
        do {
          guard case .object(let message) = try JSONDecoder().decode(JSONValue.self, from: Data(line)) else {
            continue
          }
          fireMessage(message)
        } catch {
          continue
        }
      }
    }

    fireClose()
  }

  private var isClosed: Bool {
    lock.lock()
    let value = didClose
    lock.unlock()
    return value
  }

  private func writeAll(_ data: Data) throws {
    ioLock.lock()
    defer { ioLock.unlock() }
    guard !isClosed else {
      throw SlopError.internalError("Unix socket is closed")
    }
    try data.withUnsafeBytes { rawBuffer in
      guard let baseAddress = rawBuffer.baseAddress else { return }
      var bytesWritten = 0
      while bytesWritten < data.count {
        let pointer = baseAddress.advanced(by: bytesWritten)
        let count = Darwin.write(fd, pointer, data.count - bytesWritten)
        if count <= 0 {
          throw SlopError.internalError("Unix socket write failed: \(unixErrnoDescription())")
        }
        bytesWritten += count
      }
    }
  }

  private func fireMessage(_ message: SlopMessage) {
    lock.lock()
    let handlers = messageHandlers
    if handlers.isEmpty {
      pendingMessages.append(message)
      lock.unlock()
      return
    }
    lock.unlock()

    for handler in handlers {
      handler(message)
    }
  }

  private func fireClose() {
    lock.lock()
    guard !didClose else {
      lock.unlock()
      return
    }
    didClose = true
    let handlers = closeHandlers
    lock.unlock()

    Darwin.shutdown(fd, SHUT_RDWR)
    ioLock.lock()
    Darwin.close(fd)
    ioLock.unlock()

    for handler in handlers {
      handler()
    }
  }
}

func unixErrnoDescription() -> String {
  String(cString: strerror(errno))
}
#endif
