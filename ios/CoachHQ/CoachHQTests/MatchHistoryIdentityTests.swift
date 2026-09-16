import XCTest
@testable import CoachHQ

final class MatchHistoryIdentityTests: XCTestCase {
    func testTwoSameDayScoreSavesRemainDistinctAfterEncoding() throws {
        var history = MatchHistory(version: 1, sessions: [])
        history.upsert(try session("21-18"), historyFile: "hk_2026-09-16_morning.json")
        history.upsert(try session("13-21"), historyFile: "hk_2026-09-16_evening.json")

        let decoded = try roundTrip(history)
        XCTAssertEqual(decoded.sessions.count, 2)
        XCTAssertEqual(Set(decoded.sessions.map(\.date)), ["2026-09-16"])
        XCTAssertEqual(Set(decoded.sessions.compactMap(\.historyFile)), [
            "hk_2026-09-16_morning.json", "hk_2026-09-16_evening.json",
        ])
        XCTAssertEqual(decoded.sessions.first { $0.historyFile == "hk_2026-09-16_morning.json" }?.summary.wins, 1)
        XCTAssertEqual(decoded.sessions.first { $0.historyFile == "hk_2026-09-16_evening.json" }?.summary.losses, 1)
    }

    func testResaveReplacesOnlyItsExactKeyEvenIfDateChanges() throws {
        var history = MatchHistory(version: 1, sessions: [])
        history.upsert(try session("21-18"), historyFile: "morning.json")
        history.upsert(try session("13-21"), historyFile: "evening.json")
        let evening = try XCTUnwrap(history.sessions.first { $0.historyFile == "evening.json" })

        history.upsert(try session("21-10", date: "2026-09-17"), historyFile: "morning.json")

        XCTAssertEqual(history.sessions.count, 2)
        XCTAssertEqual(history.sessions.first { $0.historyFile == "evening.json" }, evening)
        XCTAssertEqual(history.sessions.first?.historyFile, "morning.json")
        XCTAssertEqual(history.sessions.first?.date, "2026-09-17")
        XCTAssertEqual(history.sessions.first?.games.first?.scoreAgainst, 10)
    }

    func testLegacyJSONDecodesWithoutHistoryFileAndKeepsNumericActivityID() throws {
        let data = Data("""
        {"version":1,"sessions":[{"date":"2026-09-16","activityId":42,
          "summary":{"wins":1,"losses":0,"winPct":100},"games":[]}]}
        """.utf8)
        let history = try JSONDecoder().decode(MatchHistory.self, from: data)
        XCTAssertNil(history.sessions[0].historyFile)
        XCTAssertEqual(history.sessions[0].activityId, 42)
        XCTAssertEqual(try roundTrip(history), history)
    }

    func testSoleLegacyRowSurvivesAnotherSameDayMatchSaveAndResave() throws {
        var legacyMorning = try session("13-21")
        legacyMorning.activityId = 42
        var history = MatchHistory(version: 1, sessions: [legacyMorning])
        let eveningFile = "hk_2026-09-16_evening.json"

        history.upsert(try session("21-18"), historyFile: eveningFile)

        XCTAssertEqual(history.sessions.count, 2)
        XCTAssertEqual(history.sessions.filter { $0.historyFile == nil }, [legacyMorning])
        XCTAssertEqual(history.sessions.first { $0.historyFile == eveningFile }?.summary.wins, 1)
        XCTAssertNil(history.sessions.first { $0.historyFile == eveningFile }?.activityId)

        history.upsert(try session("21-15"), historyFile: eveningFile)

        XCTAssertEqual(history.sessions.count, 2)
        XCTAssertEqual(history.sessions.filter { $0.historyFile == nil }, [legacyMorning])
        XCTAssertEqual(history.sessions.first { $0.historyFile == eveningFile }?.games.first?.scoreAgainst, 15)
    }

    func testSeveralLegacyRowsOnSameDateArePreserved() throws {
        let first = try session("21-18")
        let second = try session("13-21")
        var history = MatchHistory(version: 1, sessions: [first, second])

        history.upsert(try session("21-10"), historyFile: "morning.json")

        XCTAssertEqual(history.sessions.count, 3)
        XCTAssertEqual(history.sessions.filter { $0.historyFile == nil }, [first, second])
    }

    func testLegacyRowBesideAnotherKeyedRowIsPreserved() throws {
        let legacy = try session("21-18")
        var history = MatchHistory(version: 1, sessions: [])
        history.upsert(try session("13-21"), historyFile: "morning.json")
        history.sessions.append(legacy)

        history.upsert(try session("21-10"), historyFile: "evening.json")

        XCTAssertEqual(history.sessions.count, 3)
        XCTAssertTrue(history.sessions.contains(legacy))
        history.upsert(try session("21-11"), historyFile: "morning.json")
        XCTAssertEqual(history.sessions.count, 3)
        XCTAssertTrue(history.sessions.contains(legacy))
    }

    func testHistoryFileJSONUsesExactCommittedBasename() throws {
        var history = MatchHistory(version: 1, sessions: [])
        let file = "hk_2026-09-16_AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.json"
        history.upsert(try session("21-18"), historyFile: file)
        let data = try JSONEncoder().encode(history)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let rows = try XCTUnwrap(json["sessions"] as? [[String: Any]])
        XCTAssertEqual(rows[0]["historyFile"] as? String, file)
        XCTAssertEqual(rows[0]["date"] as? String, "2026-09-16")
    }

    private func session(_ score: String, date: String = "2026-09-16") throws -> MatchSession {
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription(
            "me vs Ravi \(score)", allowMatchParsing: true
        ))
        return DescriptionParser.buildStructuredEntry(parsed, date: date, activityId: nil)
    }

    private func roundTrip(_ history: MatchHistory) throws -> MatchHistory {
        try JSONDecoder().decode(MatchHistory.self, from: JSONEncoder().encode(history))
    }
}
