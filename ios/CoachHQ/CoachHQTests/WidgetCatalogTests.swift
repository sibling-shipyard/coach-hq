import XCTest
@testable import CoachHQ

/// Home's widget order is stored data (W6); these cover the parse/encode round-trip and the
/// two behaviors the plan calls out directly: an unrecognized key never crashes, and a
/// `defaultOrder` key missing from a stored order still reaches the athlete.
final class WidgetCatalogTests: XCTestCase {

    func testParseOrderRoundTripsTheDefaultOrder() {
        let encoded = WidgetCatalogKey.encodeOrder(WidgetCatalogKey.defaultOrder)
        XCTAssertEqual(WidgetCatalogKey.parseOrder(encoded), WidgetCatalogKey.defaultOrder)
    }

    func testParseOrderDropsAnUnrecognizedKeyInsteadOfCrashing() {
        let raw = "engine,someFutureWidgetThisBuildDoesNotKnow,buildPhase"
        XCTAssertEqual(
            WidgetCatalogKey.parseOrder(raw),
            [.engine, .buildPhase, .commitments, .weeklyPlan, .caloriesAndQuest, .recentSessions]
        )
    }

    func testParseOrderOfEmptyStringYieldsTheDefaultOrder() {
        XCTAssertEqual(WidgetCatalogKey.parseOrder(""), WidgetCatalogKey.defaultOrder)
    }

    func testParseOrderAppendsMissingDefaultKeysAtTheEndInDefaultOrder() {
        // Stored order predates buildPhase and recentSessions existing as catalog keys.
        let raw = WidgetCatalogKey.encodeOrder([.weeklyPlan, .engine, .commitments, .caloriesAndQuest])
        XCTAssertEqual(
            WidgetCatalogKey.parseOrder(raw),
            [.weeklyPlan, .engine, .commitments, .caloriesAndQuest, .buildPhase, .recentSessions],
            "missing keys append at the end in defaultOrder's relative order, without disturbing the athlete's existing order"
        )
    }

    func testParseOrderPreservesDuplicatesAndCustomSequence() {
        // Not a real scenario today (nothing writes duplicates), but parseOrder itself makes
        // no uniqueness assumption — confirm it doesn't silently dedupe.
        let raw = "recentSessions,engine,recentSessions"
        XCTAssertEqual(
            WidgetCatalogKey.parseOrder(raw),
            [.recentSessions, .engine, .recentSessions, .commitments, .weeklyPlan, .caloriesAndQuest, .buildPhase]
        )
    }

    func testDefaultOrderCoversEveryCase() {
        XCTAssertEqual(Set(WidgetCatalogKey.defaultOrder), Set(WidgetCatalogKey.allCases),
                       "a case added to the enum but not to defaultOrder would silently never render")
    }
}
