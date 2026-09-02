import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

public enum ProviderTransportType: String, Codable, Equatable {
  case unix
  case ws
  case stdio
  case relay
}

public struct ProviderTransport: Codable, Equatable {
  public var type: ProviderTransportType
  public var path: String?
  public var url: String?

  public init(type: ProviderTransportType, path: String? = nil, url: String? = nil) {
    self.type = type
    self.path = path
    self.url = url
  }
}

public struct ProviderDescriptor: Codable, Equatable {
  public var id: String
  public var name: String
  public var slopVersion: String
  public var transport: ProviderTransport
  public var pid: Int?
  public var capabilities: [String]
  public var providerKey: String?
  public var source: String?

  enum CodingKeys: String, CodingKey {
    case id
    case name
    case slopVersion = "slop_version"
    case transport
    case pid
    case capabilities
    case providerKey
    case source
  }

  public init(
    id: String,
    name: String,
    slopVersion: String,
    transport: ProviderTransport,
    pid: Int? = nil,
    capabilities: [String],
    providerKey: String? = nil,
    source: String? = nil
  ) {
    self.id = id
    self.name = name
    self.slopVersion = slopVersion
    self.transport = transport
    self.pid = pid
    self.capabilities = capabilities
    self.providerKey = providerKey
    self.source = source
  }
}

public struct ConnectedProvider {
  public var id: String
  public var name: String
  public var descriptor: ProviderDescriptor
  public var consumer: SlopConsumer
  public var subscriptionID: String
  public var status: String

  public init(
    id: String,
    name: String,
    descriptor: ProviderDescriptor,
    consumer: SlopConsumer,
    subscriptionID: String,
    status: String
  ) {
    self.id = id
    self.name = name
    self.descriptor = descriptor
    self.consumer = consumer
    self.subscriptionID = subscriptionID
    self.status = status
  }
}

public struct ProviderRegistration: Equatable {
  public let id: String
  public let directory: URL
  fileprivate let device: UInt64
  fileprivate let inode: UInt64
}

private struct DiscoveryConnectionAttempt {
  var id: String
  var token: UUID
  var task: Task<ConnectedProvider?, Error>
}

private final class DiscoveryConnectionLifecycle {
  private let lock = NSLock()
  private var disconnected = false

  var isDisconnected: Bool {
    lock.lock()
    defer { lock.unlock() }
    return disconnected
  }

  func markDisconnected() {
    lock.lock()
    disconnected = true
    lock.unlock()
  }
}

public struct DiscoveryOptions {
  public var providerDirectories: [URL]
  public var autoConnect: Bool
  public var transportFactory: (ProviderDescriptor) -> ClientTransport?
  public var bridges: [DiscoveryBridge]

  public init(
    providerDirectories: [URL] = Discovery.defaultProviderDirectories,
    autoConnect: Bool = false,
    bridges: [DiscoveryBridge] = [],
    transportFactory: @escaping (ProviderDescriptor) -> ClientTransport? = Discovery.defaultTransportFactory
  ) {
    self.providerDirectories = providerDirectories
    self.autoConnect = autoConnect
    self.bridges = bridges
    self.transportFactory = transportFactory
  }
}

public final class DiscoveryService {
  private let options: DiscoveryOptions
  private let lock = NSLock()
  private var discovered: [ProviderDescriptor] = []
  private var providers: [String: ConnectedProvider] = [:]
  private var providerAliases: [String: String] = [:]
  private var connectionAttempts: [String: DiscoveryConnectionAttempt] = [:]
  private var stateChangeCallbacks: [UUID: () -> Void] = [:]
  private var bridgeUnsubscribes: [() -> Void] = []
  private var started = false
  private var generation: UInt64 = 0

  public init(options: DiscoveryOptions = DiscoveryOptions()) {
    self.options = options
  }

  public func start() async {
    let shouldStart = locked { () -> Bool in
      guard !started else { return false }
      started = true
      return true
    }
    guard shouldStart else { return }

    let unsubscribes = options.bridges.map { bridge in
      bridge.onProviderChange { [weak self] in
        self?.scan()
      }
    }
    let keepSubscriptions = locked { () -> Bool in
      guard started else { return false }
      bridgeUnsubscribes = unsubscribes
      return true
    }
    if !keepSubscriptions {
      for unsubscribe in unsubscribes {
        unsubscribe()
      }
      return
    }

    scan()
    guard options.autoConnect else { return }
    let startGeneration = locked { generation }
    for descriptor in getDiscovered() {
      guard locked({ started && generation == startGeneration }) else { return }
      _ = try? await ensureConnected(descriptor.id)
      guard locked({ started && generation == startGeneration }) else { return }
    }
  }

  public func stop() {
    let state = locked { () -> ([() -> Void], [ConnectedProvider], [Task<ConnectedProvider?, Error>], [() -> Void]) in
      let hadActiveState = started || !providers.isEmpty || !connectionAttempts.isEmpty
      started = false
      generation &+= 1
      let unsubscribes = bridgeUnsubscribes
      bridgeUnsubscribes.removeAll()
      let connectedProviders = Array(providers.values)
      providers.removeAll()
      providerAliases.removeAll()
      let tasks = connectionAttempts.values.map(\.task)
      connectionAttempts.removeAll()
      return (unsubscribes, connectedProviders, tasks, hadActiveState ? Array(stateChangeCallbacks.values) : [])
    }
    for unsubscribe in state.0 {
      unsubscribe()
    }
    for task in state.2 {
      task.cancel()
    }
    for provider in state.1 {
      provider.consumer.disconnect()
    }
    emitStateChange(state.3)
  }

  public func scan() {
    let descriptors = Discovery.readDescriptors(from: options.providerDirectories) + bridgeDescriptors()
    let callbacks = locked { () -> [() -> Void] in
      discovered = descriptors
      let descriptorIDs = Set(descriptors.map(\.id))
      providerAliases = providerAliases.filter { descriptorIDs.contains($0.key) || providers[$0.value] != nil }
      return Array(stateChangeCallbacks.values)
    }
    emitStateChange(callbacks)
  }

  public func getDiscovered() -> [ProviderDescriptor] {
    let state = locked { (started, discovered) }
    if state.0 {
      return state.1
    }
    return Discovery.readDescriptors(from: options.providerDirectories) + bridgeDescriptors()
  }

  public func getProviders() -> [ConnectedProvider] {
    locked { Array(providers.values) }
  }

  public func getProvider(_ idOrName: String) -> ConnectedProvider? {
    locked {
      if let canonical = providers[idOrName] {
        return canonical
      }
      if let providerID = providerAliases[idOrName], let aliased = providers[providerID] {
        return aliased
      }
      return providers.values.first { $0.name == idOrName }
    }
  }

  public func ensureConnected(_ idOrName: String) async throws -> ConnectedProvider? {
    let operationGeneration = locked { generation }
    if let existing = getProvider(idOrName), existing.status == "connected" {
      return existing
    }

    if !locked({ started }) {
      scan()
    }
    let attempt = locked { () -> DiscoveryConnectionAttempt? in
      guard generation == operationGeneration else { return nil }
      let existingByID = providers[idOrName] ?? providerAliases[idOrName].flatMap { providers[$0] }
      if let existing = existingByID ?? providers.values.first(where: { $0.name == idOrName }),
         existing.status == "connected" {
        return DiscoveryConnectionAttempt(
          id: existing.id,
          token: UUID(),
          task: Task<ConnectedProvider?, Error> { existing }
        )
      }
      guard let descriptor = discovered.first(where: { $0.id == idOrName || $0.name == idOrName }) else {
        return nil
      }
      if let existingAttempt = connectionAttempts[descriptor.id] {
        return existingAttempt
      }
      let token = UUID()
      let task = Task { [weak self] in
        guard let self else { throw CancellationError() }
        return try await self.connect(descriptor, generation: operationGeneration)
      }
      let attempt = DiscoveryConnectionAttempt(id: descriptor.id, token: token, task: task)
      connectionAttempts[descriptor.id] = attempt
      return attempt
    }
    guard let attempt else { return nil }

    do {
      let provider = try await attempt.task.value
      removeConnectionAttempt(attempt.token, id: attempt.id)
      return provider
    } catch {
      removeConnectionAttempt(attempt.token, id: attempt.id)
      throw error
    }
  }

  @discardableResult
  public func disconnect(_ idOrName: String) -> Bool {
    let result = locked { () -> (ConnectedProvider, [() -> Void])? in
      let providerByID = providers[idOrName] ?? providerAliases[idOrName].flatMap { providers[$0] }
      guard let provider = providerByID ?? providers.values.first(where: { $0.name == idOrName }) else {
        return nil
      }
      providers.removeValue(forKey: provider.id)
      providerAliases = providerAliases.filter { $0.value != provider.id }
      return (provider, Array(stateChangeCallbacks.values))
    }
    guard let result else { return false }
    let provider = result.0
    provider.consumer.disconnect()
    emitStateChange(result.1)
    return true
  }

  @discardableResult
  public func onStateChange(_ callback: @escaping () -> Void) -> () -> Void {
    let token = UUID()
    locked {
      stateChangeCallbacks[token] = callback
    }
    return { [weak self] in
      _ = self?.locked {
        self?.stateChangeCallbacks.removeValue(forKey: token)
      }
    }
  }

  private func emitStateChange() {
    emitStateChange(locked { Array(stateChangeCallbacks.values) })
  }

  private func emitStateChange(_ callbacks: [() -> Void]) {
    for callback in callbacks {
      callback()
    }
  }

  private func connect(_ descriptor: ProviderDescriptor, generation: UInt64) async throws -> ConnectedProvider? {
    guard let transport = options.transportFactory(descriptor) ?? relayTransport(for: descriptor) else {
      return nil
    }
    let consumer = SlopConsumer(transport: transport)
    let lifecycle = DiscoveryConnectionLifecycle()
    consumer.onPatch { [weak self] _, _, _ in
      self?.emitStateChange()
    }
    consumer.onDisconnect { [weak self, weak consumer] in
      lifecycle.markDisconnected()
      guard let self, let consumer else { return }
      let callbacks = self.locked { () -> [() -> Void] in
        guard
          let entry = self.providers.first(where: { $0.value.consumer === consumer }),
          var provider = self.providers[entry.key]
        else {
          return []
        }
        provider.status = "disconnected"
        self.providers[entry.key] = provider
        return Array(self.stateChangeCallbacks.values)
      }
      self.emitStateChange(callbacks)
    }

    return try await withTaskCancellationHandler {
      do {
        let hello = try await consumer.connect()
        let identity = try parseProviderHello(hello)
        try Task.checkCancellation()
        let subscription = try await consumer.subscribe(path: "/", depth: -1)
        try Task.checkCancellation()
        guard !lifecycle.isDisconnected else {
          throw SlopError.internalError("Provider disconnected during discovery")
        }
        var authoritativeDescriptor = descriptor
        authoritativeDescriptor.id = identity.id
        authoritativeDescriptor.name = identity.name
        authoritativeDescriptor.slopVersion = identity.slopVersion
        authoritativeDescriptor.capabilities = identity.capabilities
        let provider = ConnectedProvider(
          id: identity.id,
          name: identity.name,
          descriptor: authoritativeDescriptor,
          consumer: consumer,
          subscriptionID: subscription.id,
          status: "connected"
        )
        let callbacks = locked { () -> [() -> Void]? in
          guard self.generation == generation else { return nil }
          if let existing = providers[identity.id], existing.status == "connected", existing.consumer !== consumer {
            return nil
          }
          providers[identity.id] = provider
          providerAliases[descriptor.id] = identity.id
          return Array(stateChangeCallbacks.values)
        }
        guard let callbacks else {
          throw CancellationError()
        }
        emitStateChange(callbacks)
        return provider
      } catch {
        consumer.disconnect()
        throw error
      }
    } onCancel: {
      consumer.disconnect()
    }
  }

  private func removeConnectionAttempt(_ token: UUID, id: String) {
    locked {
      guard connectionAttempts[id]?.token == token else { return }
      connectionAttempts.removeValue(forKey: id)
    }
  }

  private func bridgeDescriptors() -> [ProviderDescriptor] {
    options.bridges
      .filter(\.running)
      .flatMap { bridge in bridge.providers().map(bridgeProviderToDescriptor) }
  }

  private func relayTransport(for descriptor: ProviderDescriptor) -> ClientTransport? {
    guard descriptor.transport.type == .relay, let providerKey = descriptor.providerKey else {
      return nil
    }
    guard let bridge = options.bridges.first(where: { bridge in
      bridge.running && bridge.providers().contains { $0.providerKey == providerKey }
    }) else {
      return nil
    }
    return BridgeRelayTransport(bridge: bridge, providerKey: providerKey)
  }

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }
}

public enum Discovery {
  public static let defaultProviderDirectories: [URL] = [
    URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".slop/providers"),
    URL(fileURLWithPath: "/tmp/slop/providers"),
  ]

  public static func defaultTransportFactory(_ descriptor: ProviderDescriptor) -> ClientTransport? {
    switch descriptor.transport.type {
    case .ws:
      guard let urlString = descriptor.transport.url, let url = URL(string: urlString) else { return nil }
      return URLSessionWebSocketTransport(url: url)
    case .unix:
      guard let path = descriptor.transport.path else { return nil }
      #if canImport(Darwin)
      return UnixSocketClientTransport(path: path)
      #else
      return nil
      #endif
    case .stdio, .relay:
      return nil
    }
  }

  public static func readDescriptors(from directories: [URL] = defaultProviderDirectories) -> [ProviderDescriptor] {
    let fileManager = FileManager.default
    let decoder = JSONDecoder()
    var descriptors: [ProviderDescriptor] = []

    for directory in directories {
      guard isSecureProviderDirectory(directory) else {
        continue
      }
      guard let files = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else {
        continue
      }
      for file in files where isValidDescriptorFilename(file.lastPathComponent) {
        guard let data = readSecureDescriptorFile(file), var descriptor = try? decoder.decode(ProviderDescriptor.self, from: data) else {
          continue
        }
        descriptor.source = descriptor.source ?? "local"
        descriptors.append(descriptor)
      }
    }

    return descriptors
  }

  @discardableResult
  public static func registerProvider(
    id: String,
    name: String,
    transport: ProviderTransport,
    directory: URL = defaultProviderDirectories[0],
    pid: Int = Int(ProcessInfo.processInfo.processIdentifier),
    capabilities: [String] = ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"]
  ) throws -> ProviderRegistration {
    guard isValidDescriptorFilename("\(id).json") else {
      throw SlopError.invalidNodeId(
        "SLOP provider id \"\(id)\" is not a valid descriptor filename stem"
      )
    }

    let fileManager = FileManager.default
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    try secureProviderDirectory(directory)

    let descriptor = ProviderDescriptor(
      id: id,
      name: name,
      slopVersion: "0.1",
      transport: transport,
      pid: pid,
      capabilities: capabilities
    )
    let data = try JSONEncoder().encode(descriptor)
    let finalURL = directory.appendingPathComponent("\(id).json")
    let tempURL = directory.appendingPathComponent("\(id).json.tmp.\(UUID().uuidString)")
    defer { try? fileManager.removeItem(at: tempURL) }
    try data.write(to: tempURL, options: .atomic)
    try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tempURL.path)
    guard readSecureDescriptorFile(tempURL) != nil else {
      throw SlopError.internalError("Could not secure SLOP provider descriptor at \(tempURL.path)")
    }
    guard let identity = descriptorFileIdentity(tempURL) else {
      throw SlopError.internalError("Could not identify SLOP provider descriptor before publishing at \(tempURL.path)")
    }
    #if canImport(Darwin) || canImport(Glibc)
    guard rename(tempURL.path, finalURL.path) == 0 else {
      throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
    #else
    if fileManager.fileExists(atPath: finalURL.path) {
      _ = try fileManager.replaceItemAt(finalURL, withItemAt: tempURL)
    } else {
      try fileManager.moveItem(at: tempURL, to: finalURL)
    }
    #endif
    return ProviderRegistration(id: id, directory: directory, device: identity.device, inode: identity.inode)
  }

  @discardableResult
  public static func registerUnixProvider(
    id: String,
    name: String,
    socketPath: String,
    directory: URL = defaultProviderDirectories[0],
    pid: Int = Int(ProcessInfo.processInfo.processIdentifier)
  ) throws -> ProviderRegistration {
    try registerProvider(
      id: id,
      name: name,
      transport: ProviderTransport(type: .unix, path: socketPath),
      directory: directory,
      pid: pid
    )
  }

  public static func unregisterProvider(id: String, directory: URL = defaultProviderDirectories[0]) {
    guard isValidDescriptorFilename("\(id).json") else { return }
    try? FileManager.default.removeItem(at: directory.appendingPathComponent("\(id).json"))
  }

  public static func unregisterProvider(_ registration: ProviderRegistration) {
    guard isValidDescriptorFilename("\(registration.id).json") else { return }
    let file = registration.directory.appendingPathComponent("\(registration.id).json")
    quarantineAndRemoveDescriptor(file, registration: registration, beforeInspection: nil)
  }

  static func unregisterProvider(
    _ registration: ProviderRegistration,
    beforeQuarantineInspection: @escaping () -> Void
  ) {
    guard isValidDescriptorFilename("\(registration.id).json") else { return }
    let file = registration.directory.appendingPathComponent("\(registration.id).json")
    quarantineAndRemoveDescriptor(
      file,
      registration: registration,
      beforeInspection: beforeQuarantineInspection
    )
  }

  public static func isValidDescriptorFilename(_ filename: String) -> Bool {
    guard filename.hasSuffix(".json") else { return false }
    let stem = filename.dropLast(5)
    let scalars = Array(stem.unicodeScalars)
    guard (1...64).contains(scalars.count), let first = scalars.first, isASCIILowercaseOrDigit(first) else { return false }
    return scalars.allSatisfy { scalar in
      isASCIILowercaseOrDigit(scalar) || scalar.value == 46 || scalar.value == 95 || scalar.value == 45
    }
  }
}

private func secureProviderDirectory(_ directory: URL) throws {
  #if canImport(Darwin) || canImport(Glibc)
  let fd = open(directory.path, O_RDONLY | O_DIRECTORY | descriptorNoFollowFlag())
  guard fd >= 0 else {
    throw SlopError.internalError("Could not safely open SLOP provider directory at \(directory.path)")
  }
  defer { close(fd) }

  var statBuffer = stat()
  guard fstat(fd, &statBuffer) == 0 else {
    throw SlopError.internalError("Could not inspect SLOP provider directory at \(directory.path)")
  }
  let mode = Int(statBuffer.st_mode)
  guard (mode & Int(S_IFMT)) == Int(S_IFDIR), currentUserID().map({ statBuffer.st_uid == $0 }) ?? true else {
    throw SlopError.internalError("SLOP provider directory is not an owned real directory at \(directory.path)")
  }
  guard fchmod(fd, 0o700) == 0 else {
    throw SlopError.internalError("Could not harden SLOP provider directory permissions at \(directory.path)")
  }
  guard fstat(fd, &statBuffer) == 0, Int(statBuffer.st_mode) & 0o077 == 0 else {
    throw SlopError.internalError("Could not verify SLOP provider directory permissions at \(directory.path)")
  }
  #else
  let fileManager = FileManager.default
  guard
    let attributes = try? fileManager.attributesOfItem(atPath: directory.path),
    attributes[.type] as? FileAttributeType == .typeDirectory
  else {
    throw SlopError.internalError("SLOP provider path is not a directory at \(directory.path)")
  }
  try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
  guard isSecureProviderDirectory(directory) else {
    throw SlopError.internalError("Could not secure SLOP provider directory at \(directory.path)")
  }
  #endif
}

private func isSecureProviderDirectory(_ directory: URL) -> Bool {
  #if canImport(Darwin) || canImport(Glibc)
  var statBuffer = stat()
  guard lstat(directory.path, &statBuffer) == 0 else {
    return false
  }
  let mode = Int(statBuffer.st_mode)
  guard (mode & Int(S_IFMT)) == Int(S_IFDIR) else {
    return false
  }
  if let uid = currentUserID(), statBuffer.st_uid != uid {
    return false
  }
  guard mode & 0o077 == 0 else {
    return false
  }
  return true
  #else
  let fileManager = FileManager.default
  guard
    let attributes = try? fileManager.attributesOfItem(atPath: directory.path),
    attributes[.type] as? FileAttributeType == .typeDirectory
  else {
    return false
  }

  if let uid = currentUserID(), let owner = attributes[.ownerAccountID] as? NSNumber, owner.uint32Value != uid {
    return false
  }

  if let permissions = attributes[.posixPermissions] as? NSNumber, permissions.intValue & 0o077 != 0 {
    return false
  }

  return true
  #endif
}

private func readSecureDescriptorFile(_ file: URL) -> Data? {
  #if canImport(Darwin) || canImport(Glibc)
  let fd = open(file.path, O_RDONLY | descriptorNoFollowFlag())
  guard fd >= 0 else {
    return nil
  }

  var statBuffer = stat()
  guard fstat(fd, &statBuffer) == 0 else {
    close(fd)
    return nil
  }

  let mode = Int(statBuffer.st_mode)
  guard (mode & Int(S_IFMT)) == Int(S_IFREG) else {
    close(fd)
    return nil
  }
  if let uid = currentUserID(), statBuffer.st_uid != uid {
    close(fd)
    return nil
  }
  guard mode & 0o077 == 0 else {
    close(fd)
    return nil
  }

  let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
  let data = handle.readDataToEndOfFile()
  try? handle.close()
  return data
  #else
  guard
    let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
    attributes[.type] as? FileAttributeType == .typeRegular
  else {
    return nil
  }
  return try? Data(contentsOf: file)
  #endif
}

private func descriptorFileIdentity(_ file: URL) -> (device: UInt64, inode: UInt64)? {
  #if canImport(Darwin) || canImport(Glibc)
  var statBuffer = stat()
  guard lstat(file.path, &statBuffer) == 0 else { return nil }
  return (UInt64(statBuffer.st_dev), UInt64(statBuffer.st_ino))
  #else
  guard
    let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
    let device = attributes[.systemNumber] as? NSNumber,
    let inode = attributes[.systemFileNumber] as? NSNumber
  else {
    return nil
  }
  return (device.uint64Value, inode.uint64Value)
  #endif
}

private func quarantineAndRemoveDescriptor(
  _ file: URL,
  registration: ProviderRegistration,
  beforeInspection: (() -> Void)?
) {
  let quarantine = file.deletingLastPathComponent().appendingPathComponent(".slop-unregister-\(UUID().uuidString)")
  #if canImport(Darwin) || canImport(Glibc)
  guard rename(file.path, quarantine.path) == 0 else { return }
  beforeInspection?()
  guard let identity = descriptorFileIdentity(quarantine) else { return }
  if identity.device == registration.device, identity.inode == registration.inode {
    _ = unlink(quarantine.path)
    return
  }
  if link(quarantine.path, file.path) == 0 {
    _ = unlink(quarantine.path)
  } else if errno == EEXIST {
    _ = unlink(quarantine.path)
  }
  #else
  guard (try? FileManager.default.moveItem(at: file, to: quarantine)) != nil else { return }
  beforeInspection?()
  guard let identity = descriptorFileIdentity(quarantine) else { return }
  if identity.device == registration.device, identity.inode == registration.inode {
    try? FileManager.default.removeItem(at: quarantine)
  } else if !FileManager.default.fileExists(atPath: file.path) {
    try? FileManager.default.moveItem(at: quarantine, to: file)
  }
  #endif
}

private func currentUserID() -> UInt32? {
  #if canImport(Darwin) || canImport(Glibc)
  return getuid()
  #else
  return nil
  #endif
}

private func descriptorNoFollowFlag() -> Int32 {
  #if canImport(Darwin) || canImport(Glibc)
  return O_NOFOLLOW
  #else
  return 0
  #endif
}

public struct DynamicToolEntry: Equatable {
  public var name: String
  public var description: String
  public var inputSchema: JSONSchema
  public var providerID: String
  public var path: String?
  public var action: String
  public var targets: [String]?

  public init(
    name: String,
    description: String,
    inputSchema: JSONSchema,
    providerID: String,
    path: String?,
    action: String,
    targets: [String]? = nil
  ) {
    self.name = name
    self.description = description
    self.inputSchema = inputSchema
    self.providerID = providerID
    self.path = path
    self.action = action
    self.targets = targets
  }
}

public struct DynamicToolSet {
  public var tools: [DynamicToolEntry]
  private var resolveMap: [String: (providerID: String, path: String?, action: String, targets: [String]?)]

  public init(tools: [DynamicToolEntry], resolveMap: [String: (providerID: String, path: String?, action: String, targets: [String]?)]) {
    self.tools = tools
    self.resolveMap = resolveMap
  }

  public func resolve(_ toolName: String) -> (providerID: String, path: String?, action: String, targets: [String]?)? {
    resolveMap[toolName]
  }
}

public func createDynamicTools(providers: [ConnectedProvider]) -> DynamicToolSet {
  var entries: [DynamicToolEntry] = []
  var resolveMap: [String: (providerID: String, path: String?, action: String, targets: [String]?)] = [:]
  var usedNames: Set<String> = []

  for provider in providers.sorted(by: { ($0.id, $0.name) < ($1.id, $1.name) }) {
    guard let tree = provider.consumer.getTree(subscriptionID: provider.subscriptionID) else {
      continue
    }
    let prefix = sanitizeToolPrefix(provider.id)
    let toolSet = affordancesToTools(tree)
    for tool in toolSet.tools {
      guard let resolved = toolSet.resolve(tool.function.name) else { continue }
      let name = reserveDynamicToolName("\(prefix)__\(tool.function.name)", used: &usedNames)
      entries.append(
        DynamicToolEntry(
          name: name,
          description: "[\(provider.name)] \(tool.function.description)",
          inputSchema: tool.function.parameters,
          providerID: provider.id,
          path: resolved.path,
          action: resolved.action,
          targets: resolved.targets
        )
      )
      resolveMap[name] = (provider.id, resolved.path, resolved.action, resolved.targets)
    }
  }

  return DynamicToolSet(tools: entries, resolveMap: resolveMap)
}

private func sanitizeToolPrefix(_ value: String) -> String {
  String(value.unicodeScalars.map { scalar -> Character in
    let value = scalar.value
    let isASCIIAlphaNumeric = (48...57).contains(value) || (65...90).contains(value) || (97...122).contains(value)
    return isASCIIAlphaNumeric ? Character(String(scalar)) : "_"
  })
}

private func reserveDynamicToolName(_ base: String, used: inout Set<String>) -> String {
  if used.insert(base).inserted {
    return base
  }
  var suffix = 2
  while !used.insert("\(base)__\(suffix)").inserted {
    suffix += 1
  }
  return "\(base)__\(suffix)"
}

private func isASCIILowercaseOrDigit(_ scalar: Unicode.Scalar) -> Bool {
  (48...57).contains(scalar.value) || (97...122).contains(scalar.value)
}
