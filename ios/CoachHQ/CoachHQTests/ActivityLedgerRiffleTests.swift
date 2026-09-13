import XCTest
@testable import CoachHQ

final class ActivityLedgerRiffleTests: XCTestCase {
    func testFrontCardWinsOverlap() {
        let back = LedgerRiffleFrame(
            id: "old",
            global: CGRect(x: 0, y: 0, width: 100, height: 128),
            peek: 64,
            z: 1
        )
        let front = LedgerRiffleFrame(
            id: "new",
            global: CGRect(x: 0, y: 0, width: 100, height: 64),
            peek: 64,
            z: 2
        )
        XCTAssertEqual(
            ActivityLedgerRiffle.cardID(at: CGPoint(x: 50, y: 32), frames: [back, front], pulledID: nil),
            "new"
        )
    }

    func testMissReturnsNil() {
        let frame = LedgerRiffleFrame(
            id: "a",
            global: CGRect(x: 0, y: 0, width: 100, height: 128),
            peek: 64,
            z: 1
        )
        XCTAssertNil(
            ActivityLedgerRiffle.cardID(at: CGPoint(x: 400, y: 400), frames: [frame], pulledID: nil)
        )
    }

    func testTuckedHitUsesPeekRow() {
        let frame = LedgerRiffleFrame(
            id: "tucked",
            global: CGRect(x: 0, y: 0, width: 100, height: 128),
            peek: 64,
            z: 1
        )
        XCTAssertNil(
            ActivityLedgerRiffle.cardID(at: CGPoint(x: 50, y: 20), frames: [frame], pulledID: nil)
        )
        XCTAssertEqual(
            ActivityLedgerRiffle.cardID(at: CGPoint(x: 50, y: 100), frames: [frame], pulledID: nil),
            "tucked"
        )
    }

    func testPulledHitUsesFullFrame() {
        let frame = LedgerRiffleFrame(
            id: "pulled",
            global: CGRect(x: 0, y: 0, width: 100, height: 128),
            peek: 64,
            z: 1
        )
        XCTAssertEqual(
            ActivityLedgerRiffle.cardID(at: CGPoint(x: 50, y: 20), frames: [frame], pulledID: "pulled"),
            "pulled"
        )
    }
}
