import Foundation

public final class TaskHandle {
  public let id: String
  private weak var server: SlopServer?
  private let label: String?
  private let cancelable: Bool
  private var task: Task<Void, Never>?
  private var cancelled = false
  private let lock = NSLock()

  init(id: String, server: SlopServer, label: String?, cancelable: Bool) {
    self.id = id
    self.server = server
    self.label = label
    self.cancelable = cancelable
  }

  public var isCancelled: Bool {
    lock.lock()
    let value = cancelled
    lock.unlock()
    return value
  }

  public func update(progress: Double, message: String) {
    lock.lock()
    guard !cancelled else {
      lock.unlock()
      return
    }
    defer { lock.unlock() }
    guard let server else { return }
    var actions: [String: Action]?
    if cancelable {
      actions = [
        "cancel": Action.value(dangerous: true) { [weak self] _ in
          self?.cancel()
          return .object(["cancelled": true])
        },
      ]
    }
    try? server.register(
      "tasks/\(id)",
      descriptor: NodeDescriptor(
        type: "status",
        props: [
          "progress": .number(progress),
          "message": .string(message),
          "status": "running",
          "action": .string(label ?? "task"),
        ],
        actions: actions,
        meta: NodeMeta(salience: 0.8)
      )
    )
  }

  func attach(_ task: Task<Void, Never>) {
    lock.lock()
    self.task = task
    let cancelImmediately = cancelled
    lock.unlock()
    if cancelImmediately {
      task.cancel()
    }
  }

  @discardableResult
  func finish(properties: [String: JSONValue], salience: Double, urgency: Urgency? = nil) -> Bool {
    lock.lock()
    guard !cancelled, let server else {
      lock.unlock()
      return false
    }
    defer { lock.unlock() }
    try? server.register(
      "tasks/\(id)",
      descriptor: NodeDescriptor(
        type: "status",
        props: properties,
        meta: NodeMeta(salience: salience, urgency: urgency)
      )
    )
    return true
  }

  func cancel() {
    lock.lock()
    cancelled = true
    let task = task
    lock.unlock()

    task?.cancel()
    guard let server else { return }
    try? server.register(
      "tasks/\(id)",
      descriptor: NodeDescriptor(
        type: "status",
        props: ["status": "cancelled", "message": "Cancelled"],
        meta: NodeMeta(salience: 0.3)
      )
    )
    Task {
      try? await Task.sleep(nanoseconds: 10_000_000_000)
      try? server.unregister("tasks/\(id)")
    }
  }
}

extension SlopServer {
  public func asyncAction(
    params: [String: ParamDef],
    label: String? = nil,
    description: String? = nil,
    cancelable: Bool = false,
    operation: @escaping ([String: JSONValue], TaskHandle) async throws -> JSONValue?
  ) -> Action {
    Action(
      params: params,
      label: label,
      description: description,
      estimate: .async
    ) { [weak self] rawParams in
      guard let self else {
        throw SlopError.internalError("SLOP server is no longer available")
      }

      let taskID = "task-\(UUID().uuidString.prefix(8))"
      let handle = TaskHandle(id: taskID, server: self, label: label, cancelable: cancelable)
      handle.update(progress: 0, message: label.map { "\($0)..." } ?? "Starting...")

      let task = Task {
        do {
          let result = try await operation(rawParams, handle)
          guard !Task.isCancelled, !handle.isCancelled else { return }
          var props: [String: JSONValue] = [
            "progress": 1,
            "message": "Complete",
            "status": "done",
          ]
          if let result {
            props["result"] = result
          }
          guard handle.finish(properties: props, salience: 0.5) else { return }
          try? await Task.sleep(nanoseconds: 30_000_000_000)
          try? self.unregister("tasks/\(taskID)")
        } catch {
          guard !Task.isCancelled, !handle.isCancelled else { return }
          _ = handle.finish(
            properties: [
              "progress": 0,
              "message": .string(error.localizedDescription),
              "status": "failed",
            ],
            salience: 1.0,
            urgency: .high
          )
        }
      }
      handle.attach(task)

      return .accepted(taskId: taskID)
    }
  }
}
