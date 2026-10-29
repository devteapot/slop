#if canImport(AppIntents)
import AppIntents
import Foundation

/// Produces a stable SLOP node ID from an App Intents entity identifier.
///
/// App entity identifiers may contain `/`, `~`, or reserved SLOP path segments.
/// Encoding the complete identifier keeps the projection stable and addressable.
@available(macOS 13.0, iOS 16.0, watchOS 9.0, tvOS 16.0, *)
public func slopNodeID(appEntityIdentifier: String) -> String {
  let encoded = Data(appEntityIdentifier.utf8)
    .base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
  return "app-entity-\(encoded)"
}

/// Projects one App Intents entity type into SLOP node descriptors.
///
/// Display title, subtitle, and the original App Intents identifier are included
/// automatically. Supply closures for app-specific properties, actions, and state.
@available(macOS 13.0, iOS 16.0, watchOS 9.0, tvOS 16.0, *)
public struct AppEntityAdapter<Entity: AppEntity> {
  public typealias ID = (Entity) -> String
  public typealias Properties = (Entity) -> [String: JSONValue]
  public typealias Summary = (Entity) -> String?
  public typealias Actions = (Entity) -> [String: Action]?
  public typealias Metadata = (Entity) -> NodeMeta?
  public typealias Content = (Entity) -> ContentRef?

  public var type: String
  private let id: ID
  private let properties: Properties
  private let summary: Summary
  private let actions: Actions
  private let metadata: Metadata
  private let content: Content

  public init(
    type: String = "app-intents:entity",
    id: @escaping ID = {
      slopNodeID(appEntityIdentifier: $0.id.entityIdentifierString)
    },
    properties: @escaping Properties = { _ in [:] },
    summary: @escaping Summary = { _ in nil },
    actions: @escaping Actions = { _ in nil },
    meta: @escaping Metadata = { _ in nil },
    contentRef: @escaping Content = { _ in nil }
  ) {
    self.type = type
    self.id = id
    self.properties = properties
    self.summary = summary
    self.actions = actions
    self.metadata = meta
    self.content = contentRef
  }

  public func nodeID(for entity: Entity) -> String {
    id(entity)
  }

  public func nodeDescriptor(for entity: Entity) -> NodeDescriptor {
    NodeDescriptor(
      type: type,
      props: mergedProperties(for: entity),
      summary: summary(entity),
      contentRef: content(entity),
      actions: actions(entity),
      meta: metadata(entity)
    )
  }

  public func itemDescriptor(for entity: Entity) -> ItemDescriptor {
    ItemDescriptor(
      id: nodeID(for: entity),
      type: type,
      props: mergedProperties(for: entity),
      summary: summary(entity),
      actions: actions(entity),
      meta: metadata(entity),
      contentRef: content(entity)
    )
  }

  public func collectionDescriptor(
    for entities: [Entity],
    type collectionType: String = "collection",
    properties: [String: JSONValue]? = nil,
    summary: String? = nil,
    actions: [String: Action]? = nil,
    meta: NodeMeta? = nil
  ) -> NodeDescriptor {
    NodeDescriptor(
      type: collectionType,
      props: properties,
      summary: summary,
      items: entities.map(itemDescriptor),
      actions: actions,
      meta: meta
    )
  }

  private func mergedProperties(for entity: Entity) -> [String: JSONValue] {
    let representation = entity.displayRepresentation
    var result: [String: JSONValue] = [
      "app_intents_identifier": .string(entity.id.entityIdentifierString),
      "label": .string(String(localized: representation.title)),
    ]
    if let subtitle = representation.subtitle {
      result["description"] = .string(String(localized: subtitle))
    }
    result.merge(properties(entity)) { _, projected in projected }
    return result
  }
}

@available(macOS 13.0, iOS 16.0, watchOS 9.0, tvOS 16.0, *)
extension Action {
  /// Wraps a typed App Intent as a SLOP affordance.
  ///
  /// `makeIntent` maps validated SLOP parameters into the concrete intent. The
  /// result mapper explicitly controls what crosses the JSON wire boundary.
  /// This calls `perform()` directly; App Intents authentication policy and
  /// system confirmation UI are not applied, so the SLOP provider must still
  /// authorize the action and mark confirmation-sensitive actions dangerous.
  public static func appIntent<Intent: AppIntent>(
    _ intentType: Intent.Type,
    params: [String: ParamDef]? = nil,
    label: String? = nil,
    description: String? = nil,
    dangerous: Bool = false,
    idempotent: Bool = false,
    estimate: ActionEstimate? = nil,
    makeIntent: @escaping ([String: JSONValue]) throws -> Intent,
    mapResult: @escaping (Intent.PerformResult) throws -> JSONValue? = { _ in nil }
  ) -> Action {
    .value(
      params: params,
      label: label ?? String(localized: intentType.title),
      description: description,
      dangerous: dangerous,
      idempotent: idempotent,
      estimate: estimate
    ) { params in
      let result = try await makeIntent(params).perform()
      return try mapResult(result)
    }
  }

  /// Wraps a parameterless App Intent using its required `init()` initializer.
  public static func appIntent<Intent: AppIntent>(
    _ intentType: Intent.Type,
    label: String? = nil,
    description: String? = nil,
    dangerous: Bool = false,
    idempotent: Bool = false,
    estimate: ActionEstimate? = nil,
    mapResult: @escaping (Intent.PerformResult) throws -> JSONValue? = { _ in nil }
  ) -> Action {
    appIntent(
      intentType,
      label: label,
      description: description,
      dangerous: dangerous,
      idempotent: idempotent,
      estimate: estimate,
      makeIntent: { _ in Intent() },
      mapResult: mapResult
    )
  }
}

@available(macOS 13.0, iOS 16.0, watchOS 9.0, tvOS 16.0, *)
extension SlopServer {
  public func registerAppEntity<Entity: AppEntity>(
    _ path: String,
    entity: Entity,
    adapter: AppEntityAdapter<Entity>
  ) throws {
    try register(path, descriptor: adapter.nodeDescriptor(for: entity))
  }

  public func registerAppEntities<Entity: AppEntity>(
    _ path: String,
    entities: [Entity],
    adapter: AppEntityAdapter<Entity>,
    type: String = "collection",
    properties: [String: JSONValue]? = nil,
    summary: String? = nil,
    actions: [String: Action]? = nil,
    meta: NodeMeta? = nil
  ) throws {
    try register(
      path,
      descriptor: adapter.collectionDescriptor(
        for: entities,
        type: type,
        properties: properties,
        summary: summary,
        actions: actions,
        meta: meta
      )
    )
  }

#if compiler(>=6.4)
  /// Resolves a macOS 27 App Intents `EntityCollection` and publishes it as a
  /// SLOP collection while preserving the collection's identifier order.
  @available(macOS 27.0, iOS 27.0, watchOS 27.0, tvOS 27.0, *)
  public func registerAppEntityCollection<Entity: AppEntity>(
    _ path: String,
    collection: EntityCollection<Entity>,
    adapter: AppEntityAdapter<Entity>,
    type: String = "collection",
    properties: [String: JSONValue]? = nil,
    summary: String? = nil,
    actions: [String: Action]? = nil,
    meta: NodeMeta? = nil
  ) async throws {
    let entities = try await collection.resolvedEntities()
    try registerAppEntities(
      path,
      entities: entities,
      adapter: adapter,
      type: type,
      properties: properties,
      summary: summary,
      actions: actions,
      meta: meta
    )
  }
#endif
}
#endif
