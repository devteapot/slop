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
  private var options: DiscoveryOptions
  private var discovered: [ProviderDescriptor] = []
  private var providers: [String: ConnectedProvider] = [:]
  private var stateChangeCallbacks: [() -> Void] = []
  private var bridgeUnsubscribes: [() -> Void] = []
  private var started = false

  public init(options: DiscoveryOptions = DiscoveryOptions()) {
    self.options = options
  }

  public func start() async {
    guard !started else { return }
    started = true
    bridgeUnsubscribes = options.bridges.map { bridge in
      bridge.onProviderChange { [weak self] in
        self?.scan()
      }
    }
    scan()
    guard options.autoConnect else { return }
    for descriptor in discovered {
      _ = try? await ensureConnected(descriptor.id)
    }
  }

  public func stop() {
    for unsubscribe in bridgeUnsubscribes {
      unsubscribe()
    }
    bridgeUnsubscribes.removeAll()
    for provider in providers.values {
      provider.consumer.disconnect()
    }
    providers.removeAll()
    started = false
    emitStateChange()
  }

  public func scan() {
    discovered = Discovery.readDescriptors(from: options.providerDirectories) + bridgeDescriptors()
    emitStateChange()
  }

  public func getDiscovered() -> [ProviderDescriptor] {
    if started {
      return discovered
    }
    return Discovery.readDescriptors(from: options.providerDirectories) + bridgeDescriptors()
  }

  public func getProviders() -> [ConnectedProvider] {
    Array(providers.values)
  }

  public func getProvider(_ idOrName: String) -> ConnectedProvider? {
    providers[idOrName] ?? providers.values.first { $0.name == idOrName }
  }

  public func ensureConnected(_ idOrName: String) async throws -> ConnectedProvider? {
    if let existing = getProvider(idOrName), existing.status == "connected" {
      return existing
    }

    if !started {
      scan()
    }
    guard let descriptor = discovered.first(where: { $0.id == idOrName || $0.name == idOrName }) else {
      return nil
    }
    guard let transport = options.transportFactory(descriptor) ?? relayTransport(for: descriptor) else {
      return nil
    }

    let consumer = SlopConsumer(transport: transport)
    _ = try await consumer.connect()
    let subscription = try await consumer.subscribe(path: "/", depth: -1)

    let provider = ConnectedProvider(
      id: descriptor.id,
      name: descriptor.name,
      descriptor: descriptor,
      consumer: consumer,
      subscriptionID: subscription.id,
      status: "connected"
    )
    providers[descriptor.id] = provider

    consumer.onPatch { [weak self] _, _, _ in
      self?.emitStateChange()
    }
    consumer.onDisconnect { [weak self] in
      guard let self else { return }
      if var provider = self.providers[descriptor.id] {
        provider.status = "disconnected"
        self.providers[descriptor.id] = provider
      }
      self.emitStateChange()
    }

    emitStateChange()
    return provider
  }

  @discardableResult
  public func disconnect(_ idOrName: String) -> Bool {
    guard let provider = getProvider(idOrName) else {
      return false
    }
    provider.consumer.disconnect()
    providers.removeValue(forKey: provider.id)
    emitStateChange()
    return true
  }

  @discardableResult
  public func onStateChange(_ callback: @escaping () -> Void) -> () -> Void {
    stateChangeCallbacks.append(callback)
    let index = stateChangeCallbacks.count - 1
    return { [weak self] in
      guard let self, self.stateChangeCallbacks.indices.contains(index) else { return }
      self.stateChangeCallbacks.remove(at: index)
    }
  }

  private func emitStateChange() {
    for callback in stateChangeCallbacks {
      callback()
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
}

public enum Discovery {
  public static let defaultProviderDirectories: [URL] = [
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".slop/providers"),
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

  public static func registerProvider(
    id: String,
    name: String,
    transport: ProviderTransport,
    directory: URL = defaultProviderDirectories[0],
    pid: Int = Int(ProcessInfo.processInfo.processIdentifier),
    capabilities: [String] = ["state", "patches", "affordances", "attention", "windowing", "async", "content_refs"]
  ) throws {
    guard isValidDescriptorFilename("\(id).json") else {
      throw SlopError.invalidNodeId(
        "SLOP provider id \"\(id)\" is not a valid descriptor filename stem"
      )
    }

    let fileManager = FileManager.default
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    try? fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)

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
    try data.write(to: tempURL, options: .atomic)
    try? fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tempURL.path)
    if fileManager.fileExists(atPath: finalURL.path) {
      try fileManager.removeItem(at: finalURL)
    }
    try fileManager.moveItem(at: tempURL, to: finalURL)
  }

  public static func registerUnixProvider(
    id: String,
    name: String,
    socketPath: String,
    directory: URL = defaultProviderDirectories[0],
    pid: Int = Int(ProcessInfo.processInfo.processIdentifier)
  ) throws {
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

  public static func isValidDescriptorFilename(_ filename: String) -> Bool {
    guard filename.hasSuffix(".json"), filename.count <= 69 else { return false }
    let stem = filename.dropLast(5)
    guard let first = stem.first, first.isLetter || first.isNumber else { return false }
    return stem.allSatisfy { character in
      character.isLowercase || character.isNumber || character == "." || character == "_" || character == "-"
    }
  }
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

  for provider in providers {
    guard let tree = provider.consumer.getTree(subscriptionID: provider.subscriptionID) else {
      continue
    }
    let prefix = sanitizeToolPrefix(provider.id)
    let toolSet = affordancesToTools(tree)
    for tool in toolSet.tools {
      guard let resolved = toolSet.resolve(tool.function.name) else { continue }
      let name = "\(prefix)__\(tool.function.name)"
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
  let mapped = value.map { character -> Character in
    character.isLetter || character.isNumber ? character : "_"
  }
  return String(mapped)
    .replacingOccurrences(of: #"_+"#, with: "_", options: .regularExpression)
    .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
}
