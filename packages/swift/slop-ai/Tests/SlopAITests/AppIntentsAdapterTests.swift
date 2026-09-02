#if canImport(AppIntents)
import AppIntents
import XCTest
@testable import SlopAI

@available(macOS 13.0, iOS 16.0, watchOS 9.0, tvOS 16.0, *)
private struct AdapterTestEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Adapter Todo"
  static var defaultQuery = AdapterTestEntityQuery()

  var id: String
  var title: String
  var completed: Bool

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(
      title: LocalizedStringResource(stringLiteral: title),
      subtitle: completed ? "Completed" : "Open"
    )
  }
}

@available(macOS 13.0, iOS 16.0, watchOS 9.0, tvOS 16.0, *)
private struct AdapterTestEntityQuery: EntityQuery {
  init() {}

  func entities(for identifiers: [String]) async throws -> [AdapterTestEntity] {
    identifiers.map { AdapterTestEntity(id: $0, title: "Resolved \($0)", completed: false) }
  }
}

@available(macOS 13.0, iOS 16.0, watchOS 9.0, tvOS 16.0, *)
private struct AdapterEchoIntent: AppIntent {
  static var title: LocalizedStringResource = "Echo entity"

  var text: String

  init() {
    text = "default"
  }

  init(text: String) {
    self.text = text
  }

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    .result(value: text)
  }
}

@available(macOS 13.0, iOS 16.0, watchOS 9.0, tvOS 16.0, *)
final class AppIntentsAdapterTests: XCTestCase {
  func testEntityProjectionPreservesSemanticsAndProducesValidIDs() throws {
    let entity = AdapterTestEntity(id: "todos/open~1", title: "Ship adapter", completed: false)
    let adapter = AppEntityAdapter<AdapterTestEntity>(
      type: "todos:todo",
      properties: { ["completed": .bool($0.completed)] },
      summary: { "\($0.title), \($0.completed ? "done" : "open")" }
    )

    let item = adapter.itemDescriptor(for: entity)

    XCTAssertEqual(item.type, "todos:todo")
    XCTAssertEqual(item.props?["label"], "Ship adapter")
    XCTAssertEqual(item.props?["description"], "Open")
    XCTAssertEqual(item.props?["completed"], false)
    XCTAssertEqual(item.props?["app_intents_identifier"], "todos/open~1")
    XCTAssertEqual(item.summary, "Ship adapter, open")
    XCTAssertFalse(item.id.contains("/"))
    XCTAssertFalse(item.id.contains("~"))
    XCTAssertNoThrow(try validateNodeID(item.id))
  }

  func testAppIntentActionExecutesTypedIntentAndMapsResult() async throws {
    let action = Action.appIntent(
      AdapterEchoIntent.self,
      params: ["text": .type("string")],
      makeIntent: { params in
        AdapterEchoIntent(text: params["text"]?.stringValue ?? "")
      },
      mapResult: { result in
        result.value.map(JSONValue.string)
      }
    )

    XCTAssertEqual(action.label, "Echo entity")
    let result = try await action.handler(["text": "hello"])
    XCTAssertEqual(result, .value("hello"))
  }

  func testServerRegistersOrderedAppEntityCollection() throws {
    let entities = [
      AdapterTestEntity(id: "first", title: "First", completed: false),
      AdapterTestEntity(id: "second", title: "Second", completed: true),
    ]
    let adapter = AppEntityAdapter<AdapterTestEntity>(type: "todos:todo")
    let server = SlopServer(id: "todos", name: "Todos")

    try server.registerAppEntities(
      "list",
      entities: entities,
      adapter: adapter,
      properties: ["count": 2]
    )

    let collection = try XCTUnwrap(server.tree.children?.first)
    XCTAssertEqual(collection.type, "collection")
    XCTAssertEqual(collection.properties?["count"], 2)
    XCTAssertEqual(collection.children?.map(\.type), ["todos:todo", "todos:todo"])
    XCTAssertEqual(collection.children?.compactMap { $0.properties?["label"]?.stringValue }, ["First", "Second"])
  }

#if compiler(>=6.4)
  @available(macOS 27.0, iOS 27.0, watchOS 27.0, tvOS 27.0, *)
  func testEntityCollectionRegistrationResolvesIdentifiers() async throws {
    let adapter = AppEntityAdapter<AdapterTestEntity>(type: "todos:todo")
    let server = SlopServer(id: "todos", name: "Todos")
    let collection = EntityCollection<AdapterTestEntity>(identifiers: ["one", "two"])

    try await server.registerAppEntityCollection(
      "resolved",
      collection: collection,
      adapter: adapter
    )

    let labels = server.tree.children?.first?.children?.compactMap {
      $0.properties?["label"]?.stringValue
    }
    XCTAssertEqual(labels, ["Resolved one", "Resolved two"])
  }
#endif
}
#endif
