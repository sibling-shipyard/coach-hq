import XCTest
@testable import CoachHQ

/// Home's widget order is stored data (W6); these cover the parse/encode round-trip and the
/// one behavior the plan calls out directly: an unrecognized key never crashes.
final class WidgetCatalogTests: XCTestCase {

    func testParseOrderRoundTripsTheDefaultOrder() {
        let encoded = WidgetCatalogKey.encodeOrder(WidgetCatalogKey.defaultOrder)
        XCTAssertEqual(WidgetCatalogKey.parseOrder(encoded), WidgetCatalogKey.defaultOrder)
    }

    func testParseOrderDropsAnUnrecognizedKeyInsteadOfCrashing() {
        let raw = "engine,someFutureWidgetThisBuildDoesNotKnow,buildPhase"
        XCTAssertEqual(WidgetCatalogKey.parseOrder(raw), [.engine, .buildPhase])
    }

    func testParseOrderOfEmptyStringIsEmpty() {
        XCTAssertEqual(WidgetCatalogKey.parseOrder(""), [])
    }

    func testParseOrderPreservesDuplicatesAndCustomSequence() {
        // Not a real scenario today (nothing writes duplicates), but parseOrder itself makes
        // no uniqueness assumption — confirm it doesn't silently dedupe.
        let raw = "recentSessions,engine,recentSessions"
        XCTAssertEqual(WidgetCatalogKey.parseOrder(raw), [.recentSessions, .engine, .recentSessions])
    }

    func testDefaultOrderCoversEveryCase() {
        XCTAssertEqual(Set(WidgetCatalogKey.defaultOrder), Set(WidgetCatalogKey.allCases),
                       "a case added to the enum but not to defaultOrder would silently never render")
    }
}
