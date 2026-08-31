import XCTest
@testable import CoachHQ

/// Selector cases matching A5 `workoutPage.test.ts`. No new XCTest target — this is
/// `CoachHQTests`, which `ios-build.yml` already runs.
final class WorkoutsPageSelectorTests: XCTestCase {

    private let kolkata = "Asia/Kolkata"
    /// 2026-09-01 06:30 UTC = 31 Aug evening in America/Los_Angeles, 1 Sep midday in Kolkata.
    private let splitInstant = ISO8601DateFormatter().date(from: "2026-09-01T06:30:00Z")!
    private let weekStart = "2026-08-31"
    private let tuesday = "2026-09-01"
    private let wednesday = "2026-09-02"

    func testLiveRunnableFromSessionFile() {
        let template = fixtureWorkout(id: "workout_a", title: "Template pull")
        let session = fixtureWorkout(id: "workout_a", title: "Today's pull")
        let json = liveWeek(days: [
            day(tuesday, templateId: "workout_a", title: "Pull + handstand", duration: 45),
        ])

        let page = WorkoutsPageSelector.select(
            templates: [template],
            sessions: ["workout_a": session],
            currentWeekJSON: json,
            activities: [],
            now: splitInstant,
            athleteTimeZone: nil
        )

        guard case .runnable(let workout, let from, let isDone) = page.today else {
            return XCTFail("expected runnable, got \(page.today)")
        }
        XCTAssertEqual(workout.title, "Today's pull")
        XCTAssertEqual(from, .session)
        XCTAssertFalse(isDone)
        XCTAssertNotNil(page.week)
        XCTAssertEqual(page.week?.first { $0.date == tuesday }?.source, .plan)
    }

    func testLiveRunnableFallsBackToTemplate() {
        let template = fixtureWorkout(id: "workout_a", title: "Template pull")
        let json = liveWeek(days: [
            day(tuesday, templateId: "workout_a", title: "Pull + handstand", duration: 45),
        ])

        let page = WorkoutsPageSelector.select(
            templates: [template],
            sessions: [:],
            currentWeekJSON: json,
            activities: [],
            now: splitInstant,
            athleteTimeZone: nil
        )

        guard case .runnable(let workout, let from, _) = page.today else {
            return XCTFail("expected runnable, got \(page.today)")
        }
        XCTAssertEqual(workout.title, "Template pull")
        XCTAssertEqual(from, .template)
    }

    func testLiveDoneStillRunnable() {
        let template = fixtureWorkout(id: "workout_a")
        let json = liveWeek(days: [
            day(tuesday, templateId: "workout_a", title: "Pull", duration: 45, status: "done"),
        ])

        let page = WorkoutsPageSelector.select(
            templates: [template],
            sessions: [:],
            currentWeekJSON: json,
            activities: [],
            now: splitInstant,
            athleteTimeZone: nil
        )

        guard case .runnable(_, _, let isDone) = page.today else {
            return XCTFail("expected runnable, got \(page.today)")
        }
        XCTAssertTrue(isDone)
    }

    func testLiveMentionBadminton() {
        let json = liveWeek(days: [
            day(tuesday, templateId: nil, title: "Ranked court", duration: 90, discipline: "badminton"),
        ])

        let page = WorkoutsPageSelector.select(
            templates: [],
            sessions: [:],
            currentWeekJSON: json,
            activities: [],
            now: splitInstant,
            athleteTimeZone: nil
        )

        guard case .mention(let title, let duration) = page.today else {
            return XCTFail("expected mention, got \(page.today)")
        }
        XCTAssertEqual(title, "Ranked court")
        XCTAssertEqual(duration, 90)
        XCTAssertEqual(page.week?.first { $0.date == tuesday }?.source, .plan)
    }

    func testLiveRestWhenNoSessionToday() {
        let json = liveWeek(days: [
            day(weekStart, templateId: "workout_a", title: "Monday pull", duration: 45),
        ])

        let page = WorkoutsPageSelector.select(
            templates: [fixtureWorkout(id: "workout_a")],
            sessions: [:],
            currentWeekJSON: json,
            activities: [],
            now: splitInstant,
            athleteTimeZone: nil
        )

        XCTAssertEqual(page.today, .rest)
        XCTAssertEqual(page.week?.count, 7)
        XCTAssertEqual(page.week?.first { $0.date == weekStart }?.source, .plan)
        XCTAssertEqual(page.week?.first { $0.date == tuesday }?.source, .empty)
    }

    func testNoPlanWithHistShowsWeekAndTodayNone() {
        let activities = [
            WorkoutPageActivity(start: "\(weekStart)T08:00:00", sport: "strength", title: "Strength", durationMin: 40),
            WorkoutPageActivity(start: "\(wednesday)T18:00:00", sport: "badminton", title: "Badminton", durationMin: 90),
        ]

        let page = WorkoutsPageSelector.select(
            templates: [],
            sessions: [:],
            currentWeekJSON: placeholderWeek(),
            activities: activities,
            now: splitInstant,
            athleteTimeZone: kolkata
        )

        XCTAssertEqual(page.today, .none)
        guard let week = page.week else {
            return XCTFail("expected hist week")
        }
        XCTAssertEqual(week.count, 7)
        XCTAssertEqual(week.first { $0.date == weekStart }?.source, .activity)
        XCTAssertEqual(week.first { $0.date == weekStart }?.title, "Strength")
        XCTAssertEqual(week.first { $0.date == wednesday }?.source, .activity)
        XCTAssertEqual(week.first { $0.date == wednesday }?.title, "Badminton")
        XCTAssertEqual(week.first { $0.date == tuesday }?.source, .empty)
        XCTAssertNil(week.first { $0.date == tuesday }?.title)
    }

    func testNoPlanAndNoHistHidesWeek() {
        let page = WorkoutsPageSelector.select(
            templates: [],
            sessions: [:],
            currentWeekJSON: nil,
            activities: [],
            now: splitInstant,
            athleteTimeZone: kolkata
        )

        XCTAssertEqual(page.today, .none)
        XCTAssertNil(page.week)
    }

    func testMalformedCurrentWeekNeverCrashes() {
        let junk = Data("{not-json".utf8)
        let page = WorkoutsPageSelector.select(
            templates: [],
            sessions: [:],
            currentWeekJSON: junk,
            activities: [],
            now: splitInstant,
            athleteTimeZone: kolkata
        )
        XCTAssertEqual(page.today, .none)
        XCTAssertNil(page.week)
    }

    func testTimezoneUsesAthleteNotUTCMinusEight() {
        // splitInstant is 31 Aug in America/Los_Angeles and 1 Sep in Asia/Kolkata.
        // A session only on Tuesday must be today's runnable under Kolkata, rest under LA.
        let json = liveWeek(timezone: kolkata, days: [
            day(tuesday, templateId: "workout_a", title: "Pull", duration: 45),
        ])
        let template = fixtureWorkout(id: "workout_a")

        let athlete = WorkoutsPageSelector.select(
            templates: [template],
            sessions: [:],
            currentWeekJSON: json,
            activities: [],
            now: splitInstant,
            athleteTimeZone: "America/Los_Angeles"
        )
        guard case .runnable = athlete.today else {
            return XCTFail("athlete tz must win; got \(athlete.today)")
        }

        let laWeek = liveWeek(timezone: "America/Los_Angeles", days: [
            day(tuesday, templateId: "workout_a", title: "Pull", duration: 45),
        ])
        let browser = WorkoutsPageSelector.select(
            templates: [template],
            sessions: [:],
            currentWeekJSON: laWeek,
            activities: [],
            now: splitInstant,
            athleteTimeZone: kolkata
        )
        XCTAssertEqual(browser.today, .rest, "live timezone is current_week.timezone, not athlete fallback")
    }

    func testEmptyWeekDayIsUnplannedNotRest() {
        let json = liveWeek(days: [
            day(tuesday, templateId: "workout_a", title: "Pull", duration: 45),
        ])
        let page = WorkoutsPageSelector.select(
            templates: [fixtureWorkout(id: "workout_a")],
            sessions: [:],
            currentWeekJSON: json,
            activities: [],
            now: splitInstant,
            athleteTimeZone: nil
        )
        let monday = page.week?.first { $0.date == weekStart }
        XCTAssertEqual(monday?.source, .empty)
        XCTAssertNil(monday?.title)
    }

    func testIsoWeekDatesAreMondayThroughSunday() {
        let days = WorkoutsPageSelector.isoWeekDates(containing: tuesday)
        XCTAssertEqual(days, [
            "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03",
            "2026-09-04", "2026-09-05", "2026-09-06",
        ])
    }

    // MARK: - Fixtures

    private func fixtureWorkout(id: String, title: String = "Pull") -> Workout {
        Workout(
            id: id,
            title: title,
            subtitle: "",
            sessionDate: nil,
            basedOnTemplate: nil,
            workoutType: .calisthenics,
            estimatedDurationMins: 45,
            location: "",
            equipment: [],
            coachingNote: "",
            phases: [],
            progressionNotes: nil
        )
    }

    private func liveWeek(
        timezone: String = "Asia/Kolkata",
        days: [[String: Any]]
    ) -> Data {
        weekJSON(status: "live", timezone: timezone, days: days)
    }

    private func placeholderWeek() -> Data {
        weekJSON(status: "placeholder", timezone: kolkata, days: [])
    }

    private func weekJSON(status: String, timezone: String, days: [[String: Any]]) -> Data {
        let payload: [String: Any] = [
            "schema_version": 1,
            "data_status": status,
            "timezone": timezone,
            "week": [
                "id": "2026-W36",
                "start_date": weekStart,
                "end_date": "2026-09-06",
            ],
            "days": days,
        ]
        return try! JSONSerialization.data(withJSONObject: payload)
    }

    private func day(
        _ date: String,
        templateId: String?,
        title: String,
        duration: Int,
        status: String = "planned",
        discipline: String = "calisthenics"
    ) -> [String: Any] {
        var session: [String: Any] = [
            "title": title,
            "planned_duration_min": duration,
            "status": status,
            "discipline": discipline,
        ]
        if let templateId {
            session["template_id"] = templateId
        } else {
            session["template_id"] = NSNull()
        }
        return ["date": date, "sessions": [session]]
    }
}
