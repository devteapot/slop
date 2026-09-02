import Foundation

public final class StdioProviderTransport {
  private let server: SlopServer
  private let connection: StdioConnection
  private var isRunning = false

  public init(
    server: SlopServer,
    input: FileHandle = .standardInput,
    output: FileHandle = .standardOutput
  ) {
    self.server = server
    connection = StdioConnection(input: input, output: output)
  }

  public func start() {
    guard !isRunning else { return }
    isRunning = true
    server.attachConnection(connection)
    connection.startReading()
  }

  public func stop() {
    guard isRunning else { return }
    isRunning = false
    connection.close()
    server.handleDisconnect(connection)
  }

  deinit {
    stop()
  }
}

public final class StdioConnection: SlopConnection {
  private let input: FileHandle
  private let output: FileHandle
  private let lock = NSLock()
  private let writeQueue = DispatchQueue(label: "dev.slop.stdio.write")
  private let readQueue = DispatchQueue(label: "dev.slop.stdio.read", qos: .utility)
  private var messageHandlers: [(SlopMessage) -> Void] = []
  private var closeHandlers: [() -> Void] = []
  private var pendingMessages: [SlopMessage] = []
  private var didClose = false

  public init(input: FileHandle = .standardInput, output: FileHandle = .standardOutput) {
    self.input = input
    self.output = output
  }

  public func send(_ message: SlopMessage) {
    writeQueue.sync {
      do {
        var data = try JSONEncoder().encode(JSONValue.object(message))
        data.append(0x0A)
        output.write(data)
      } catch {
        fireClose()
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
    readQueue.async { [weak self] in
      self?.readLoop()
    }
  }

  private func readLoop() {
    var pending = Data()
    while !isClosed {
      let chunk = input.readData(ofLength: 1)
      if chunk.isEmpty {
        break
      }
      pending.append(chunk)

      while let newline = pending.firstIndex(of: 0x0A) {
        let line = pending[..<newline]
        pending.removeSubrange(pending.startIndex...newline)
        guard !line.isEmpty else { continue }
        guard case .object(let message) = try? JSONDecoder().decode(JSONValue.self, from: Data(line)) else {
          continue
        }
        fireMessage(message)
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

    for handler in handlers {
      handler()
    }
  }
}

extension SlopServer {
  @discardableResult
  public func listenStdio(
    input: FileHandle = .standardInput,
    output: FileHandle = .standardOutput
  ) -> StdioProviderTransport {
    let transport = StdioProviderTransport(server: self, input: input, output: output)
    transport.start()
    return transport
  }
}
