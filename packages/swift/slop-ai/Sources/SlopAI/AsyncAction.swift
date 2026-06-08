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
    lock.unlock()
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
          try? self.register(
            "tasks/\(taskID)",
            descriptor: NodeDescriptor(
              type: "status",
              props: props,
              meta: NodeMeta(salience: 0.5)
            )
          )
          try? await Task.sleep(nanoseconds: 30_000_000_000)
          try? self.unregister("tasks/\(taskID)")
        } catch {
          guard !Task.isCancelled, !handle.isCancelled else { return }
          try? self.register(
            "tasks/\(taskID)",
            descriptor: NodeDescriptor(
              type: "status",
              props: [
                "progress": 0,
                "message": .string(error.localizedDescription),
                "status": "failed",
              ],
              meta: NodeMeta(salience: 1.0, urgency: .high)
            )
          )
        }
      }
      handle.attach(task)

      return .accepted(taskId: taskID)
    }
  }
}
