import XCTest
@testable import CoachHQ

/// Covers the two halves of `DescriptionParser`: match text still parses and formats exactly
/// as it did (regression guard for the score-entry sport), and anything else is kept as a
/// plain free-text note so every sport can carry a description (#766).
final class DescriptionParserTests: XCTestCase {

    // MARK: - Match parsing regressions

    func testDoublesMatchRoundTrips() throws {
        let raw = [
            "Tony me vs Alston/Wei 21-18",
            "Tony me vs Alex/Yin 13-21",
        ].joined(separator: "\n")

        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription(raw))
        XCTAssertFalse(parsed.isPlainNote)
        XCTAssertEqual(parsed.ranked.count, 2)

        let formatted = DescriptionParser.formatDescription(parsed)
        XCTAssertEqual(
            formatted,
            """
            1W-1L (50%)

            Games:
            W 21-18 w/ Tony vs Alston + Wei
            L 13-21 w/ Tony vs Alex + Yin
            """
        )
    }

    func testSinglesMatchRoundTrips() throws {
        // Singles takes the partner-less form.
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription("me vs Ravi 6-4"))
        XCTAssertFalse(parsed.isPlainNote)
        XCTAssertEqual(parsed.ranked.first?.isSingles, true)
        XCTAssertNil(parsed.ranked.first?.partner)
        XCTAssertEqual(
            DescriptionParser.formatDescription(parsed),
            """
            1W-0L (100%)

            Games:
            W 6-4 vs Ravi
            """
        )
    }

    func testSeparatorSplitsRankedFromFriendliesAndOnlyRankedCount() throws {
        let raw = [
            "#notes Legs heavy from Tuesday",
            "#rank 4",
            "PRE: 7, sharp",
            "Tony me vs Alston/Wei 21-18",
            "---",
            "Tony me vs Alex/Yin 15-21",
        ].joined(separator: "\n")

        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription(raw))
        XCTAssertEqual(parsed.notes, "Legs heavy from Tuesday")
        XCTAssertEqual(parsed.rank, 4)
        XCTAssertEqual(parsed.preMentalState, ParsedPreMentalState(score: 7, word: "sharp"))
        XCTAssertEqual(parsed.ranked.count, 1)
        XCTAssertEqual(parsed.friendlies.count, 1)

        let formatted = DescriptionParser.formatDescription(parsed)
        XCTAssertEqual(
            formatted,
            """
            Legs heavy from Tuesday

            1W-0L (100%) | Rank: #4

            Games:
            W 21-18 w/ Tony vs Alston + Wei

            Friendlies:
            L 15-21 w/ Tony vs Alex + Yin
            """
        )
    }

    func testStructuredEntryStillBuiltForMatches() throws {
        let raw = [
            "Tony me vs Alston/Wei 21-18",
            "---",
            "me vs Ravi 13-21",
        ].joined(separator: "\n")
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription(raw))
        let session = DescriptionParser.buildStructuredEntry(parsed, date: "2026-03-27", activityId: 42)

        XCTAssertEqual(session.date, "2026-03-27")
        XCTAssertEqual(session.activityId, 42)
        XCTAssertEqual(session.summary, MatchSummary(wins: 1, losses: 1, winPct: 50))
        XCTAssertEqual(session.games.map(\.category), ["ranked", "friendly"])
        XCTAssertEqual(session.games.map(\.format), ["doubles", "singles"])
    }

    func testMalformedLineAlongsideGamesStillWarns() throws {
        let raw = [
            "Tony me vs Alston/Wei 21-18",
            "me vs nonsense",
        ].joined(separator: "\n")
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription(raw))
        XCTAssertEqual(parsed.ranked.count, 1)
        XCTAssertEqual(parsed.warnings.count, 1)
        // The bad line is dropped from the formatted match, not smuggled in as a note.
        XCTAssertNil(parsed.notes)
    }

    func testFormattedMatchIsNotReparsed() {
        let formatted = "4W-7L (36%)\n\nGames:\nW 21-18 w/ Tony vs Alston + Wei"
        XCTAssertTrue(DescriptionParser.isAlreadyFormatted(formatted))
        XCTAssertNil(DescriptionParser.parseRawDescription(formatted))
    }

    // MARK: - Plain free-text notes (#766)

    func testPlainSentenceBecomesANote() throws {
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription("Easy shakeout, calves tight."))
        XCTAssertTrue(parsed.isPlainNote)
        XCTAssertEqual(parsed.notes, "Easy shakeout, calves tight.")
        XCTAssertTrue(parsed.ranked.isEmpty)
        XCTAssertTrue(parsed.friendlies.isEmpty)
        XCTAssertTrue(parsed.warnings.isEmpty)
    }

    func testNoteFormatsBackToItself() throws {
        let note = "Long ride into a headwind.\n\nBonked at 80km — need to eat earlier."
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription(note))
        XCTAssertEqual(DescriptionParser.formatDescription(parsed), note)
    }

    func testNoteRoundTripIsStable() throws {
        // Reopening a saved note must not rewrite it — the editor reparses what it saved.
        let note = "Shoulder twinged on the last set."
        let once = DescriptionParser.formatDescription(
            try XCTUnwrap(DescriptionParser.parseRawDescription(note))
        )
        let twice = DescriptionParser.formatDescription(
            try XCTUnwrap(DescriptionParser.parseRawDescription(once))
        )
        XCTAssertEqual(once, note)
        XCTAssertEqual(twice, note)
    }

    func testNoteNeedsNoNotesPrefixButStillHonoursOne() throws {
        let withPrefix = try XCTUnwrap(DescriptionParser.parseRawDescription("#notes Felt strong"))
        XCTAssertTrue(withPrefix.isPlainNote)
        XCTAssertEqual(withPrefix.notes, "Felt strong")

        let without = try XCTUnwrap(DescriptionParser.parseRawDescription("Felt strong"))
        XCTAssertEqual(without.notes, "Felt strong")
    }

    func testMetadataOnlyInputKeepsItsNote() throws {
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription("#notes Just warming up\n#rank 5"))
        XCTAssertTrue(parsed.isPlainNote)
        XCTAssertEqual(parsed.notes, "Just warming up")
        XCTAssertEqual(parsed.rank, 5)
    }

    func testPreStateSurvivesOnANoteOnlyDescription() throws {
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription("PRE: 6, flat\nLegs never woke up."))
        XCTAssertTrue(parsed.isPlainNote)
        XCTAssertEqual(parsed.preMentalState, ParsedPreMentalState(score: 6, word: "flat"))
        XCTAssertEqual(parsed.notes, "Legs never woke up.")

        // A note writes no match_history.json, so formatting is the only place PRE can
        // survive. Dropping it here would delete a line the athlete typed.
        let formatted = DescriptionParser.formatDescription(parsed)
        XCTAssertEqual(formatted, "Legs never woke up.\nPRE: 6, flat")
        let reparsed = try XCTUnwrap(DescriptionParser.parseRawDescription(formatted))
        XCTAssertEqual(reparsed.preMentalState, parsed.preMentalState)
        XCTAssertEqual(reparsed.notes, parsed.notes)
    }

    func testRankSurvivesOnANoteOnlyDescription() throws {
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription("#rank 4\nEasy shakeout."))
        XCTAssertTrue(parsed.isPlainNote)
        XCTAssertEqual(parsed.rank, 4)

        let formatted = DescriptionParser.formatDescription(parsed)
        XCTAssertEqual(formatted, "Easy shakeout.\n#rank 4")
        let reparsed = try XCTUnwrap(DescriptionParser.parseRawDescription(formatted))
        XCTAssertEqual(reparsed.rank, 4)
        XCTAssertEqual(reparsed.notes, "Easy shakeout.")
    }

    func testMalformedMatchTextWithNoGamesIsKeptAsProse() throws {
        // "me vs" with no score is not a game line, so it must survive as prose.
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription("me vs the hill again"))
        XCTAssertTrue(parsed.isPlainNote)
        XCTAssertEqual(parsed.notes, "me vs the hill again")
        XCTAssertTrue(parsed.warnings.isEmpty)
    }

    func testEmptyInputIsStillNil() {
        XCTAssertNil(DescriptionParser.parseRawDescription(""))
        XCTAssertNil(DescriptionParser.parseRawDescription("   \n\n  "))
    }

    func testCarriageReturnsAreNormalized() throws {
        let parsed = try XCTUnwrap(DescriptionParser.parseRawDescription("First line.\r\nSecond line."))
        XCTAssertEqual(parsed.notes, "First line.\nSecond line.")
    }

    // MARK: - Sport gate

    func testMatchTextOnANonScoreEntrySportIsJustANote() throws {
        // The gate that stops a run writing into match_history.json. Same input as
        // testDoublesMatchRoundTrips, parsed for a sport that does not do scores.
        let raw = "Tony me vs Alston/Wei 21-18"
        let asMatch = try XCTUnwrap(DescriptionParser.parseRawDescription(raw))
        XCTAssertFalse(asMatch.isPlainNote)

        let asNote = try XCTUnwrap(
            DescriptionParser.parseRawDescription(raw, allowMatchParsing: false)
        )
        XCTAssertTrue(asNote.isPlainNote)
        XCTAssertEqual(asNote.notes, raw)
        XCTAssertTrue(asNote.ranked.isEmpty)
        XCTAssertTrue(asNote.friendlies.isEmpty)
        // isPlainNote is what ActivityDetailView.saveAndSync checks before writing history.
        XCTAssertEqual(DescriptionParser.formatDescription(asNote), raw)
    }

    func testTheGateMatchesTheOnlyScoreEntrySport() {
        // If this changes, the doc in ios-app-spec.md changes with it.
        XCTAssertTrue(Theme.sportSupportsScoreEntry(for: "Badminton"))
        XCTAssertFalse(Theme.sportSupportsScoreEntry(for: "Tennis"))
        XCTAssertFalse(Theme.sportSupportsScoreEntry(for: "Run"))
    }
}
