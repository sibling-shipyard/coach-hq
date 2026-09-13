import XCTest
@testable import CoachHQ

/// `WorkoutsPageSelector` is pure, so these exercise the band rules directly (A5-ios), mirroring
/// `workoutsPageSelector.test.ts` on the web side without translating its test bodies literally.
final class WorkoutsPageSelectorTests: XCTestCase {

    // MARK: - Fixtures

    private func template(id: String = "tmpl_a") -> Workout {
        Workout(
            id: id, title: "Foundation A", subtitle: "Full body", sessionDate: nil,
            basedOnTemplate: nil, workoutType: .foundation, estimatedDurationMins: 30,
            location: "home", equipment: [], coachingNote: "", phases: [], progressionNotes: nil
        )
    }

    private func session(id: String, templateId: String?, date: String, done: Bool = false) -> Workout {
        Workout(
            id: id, title: "Coach-adjusted", subtitle: "Adjusted for today", sessionDate: date,
            basedOnTemplate: templateId, workoutType: .foundation, estimatedDurationMins: 25,
            location: "home", equipment: [], coachingNote: "", phases: [], progressionNotes: nil
        )
    }

    private func currentWeekSession(
        id: String = "s1",
        discipline: CurrentWeekSessionDiscipline = .foundation,
        title: String = "Full body",
        status: CurrentWeekSessionStatus = .planned,
        templateId: String? = "tmpl_a",
        sessionFile: String? = nil,
        durationMin: Int? = 30
    ) -> CurrentWeekSession {
        CurrentWeekSession(
            id: id, origin: .planned, discipline: discipline, kind: "strength", title: title,
            priority: .anchor, status: status, plannedDurationMin: durationMin,
            templateId: templateId, sessionFile: sessionFile, coachNote: nil,
            originalDate: nil, completionActivityIds: []
        )
    }

    private func day(date: String, sessions: [CurrentWeekSession] = []) -> CurrentWeekDay {
        CurrentWeekDay(date: date, intent: nil, coachNote: nil, sessions: sessions)
    }

    private func week(days: [CurrentWeekDay]) -> CurrentWeek {
        CurrentWeek(
            schemaVersion: 1, dataStatus: "live", timezone: "UTC",
            week: CurrentWeekRange(id: "2026-W37", startDate: "2026-09-07", endDate: "2026-09-13", focus: nil, guardrails: []),
            coachRead: CoachRead(headline: "Solid week", body: "Keep it up", validFrom: "2026-09-07", validUntil: "2026-09-13"),
            days: days, updatedAt: "2026-09-07T00:00:00Z", updatedBy: "coach", traceId: "t1"
        )
    }

    private let live = CurrentWeekAvailability(status: .current, available: true)

    // MARK: - Today band

    func testTodayWithNoSessionIsRest() {
        let plan = week(days: [day(date: "2026-09-09")])
        let input = WorkoutsPageSelector.Input(
            currentWeek: plan, availability: live, templates: [], sessionsForToday: [:],
            loggedActivities: [], today: "2026-09-09"
        )
        XCTAssertEqual(WorkoutsPageSelector.select(input).today, .rest)
    }

    func testLiveSessionWithNoTemplateIdIsAMentionNeverRest() {
        let plan = week(days: [day(date: "2026-09-09", sessions: [
            currentWeekSession(title: "Badminton match", templateId: nil, durationMin: 60),
        ])])
        let input = WorkoutsPageSelector.Input(
            currentWeek: plan, availability: live, templates: [], sessionsForToday: [:],
            loggedActivities: [], today: "2026-09-09"
        )
        guard case .mention(let title, let duration) = WorkoutsPageSelector.select(input).today else {
            return XCTFail("expected .mention")
        }
        XCTAssertEqual(title, "Badminton match")
        XCTAssertEqual(duration, 60)
    }

    func testLiveSessionResolvesToTemplateWhenNoCoachSessionFileExists() {
        let plan = week(days: [day(date: "2026-09-09", sessions: [currentWeekSession()])])
        let input = WorkoutsPageSelector.Input(
            currentWeek: plan, availability: live, templates: [template()], sessionsForToday: [:],
            loggedActivities: [], today: "2026-09-09"
        )
        guard case .runnable(let workout, let isSession, let done) = WorkoutsPageSelector.select(input).today else {
            return XCTFail("expected .runnable")
        }
        XCTAssertEqual(workout.id, "tmpl_a")
        XCTAssertFalse(isSession)
        XCTAssertFalse(done)
    }

    func testLiveSessionPrefersCoachAdjustedSessionFileOverTemplate() {
        let plan = week(days: [day(date: "2026-09-09", sessions: [
            currentWeekSession(status: .done, sessionFile: "user_data/activities/workout_plans/sessions/2026-09-09_tmpl_a.json"),
        ])])
        let sessions = ["tmpl_a": session(id: "tmpl_a", templateId: "tmpl_a", date: "2026-09-09")]
        let input = WorkoutsPageSelector.Input(
            currentWeek: plan, availability: live, templates: [template()], sessionsForToday: sessions,
            loggedActivities: [], today: "2026-09-09"
        )
        guard case .runnable(let workout, let isSession, let done) = WorkoutsPageSelector.select(input).today else {
            return XCTFail("expected .runnable")
        }
        XCTAssertEqual(workout.title, "Coach-adjusted")
        XCTAssertTrue(isSession)
        XCTAssertTrue(done, "session already marked done stays runnable, badged done")
    }

    // MARK: - Week band

    func testWeekRowsFillFromThePlanRegardlessOfWhichDayIsToday() {
        let plan = week(days: [
            day(date: "2026-09-07"),
            day(date: "2026-09-08", sessions: [currentWeekSession(title: "Long run", durationMin: 45)]),
        ])
        let input = WorkoutsPageSelector.Input(
            currentWeek: plan, availability: live, templates: [], sessionsForToday: [:],
            loggedActivities: [], today: "2026-09-07"
        )
        let week = WorkoutsPageSelector.select(input).week
        XCTAssertEqual(week?[0].isFilled, false, "blank day means unplanned, not rest")
        XCTAssertEqual(week?[1].isFilled, true)
        XCTAssertEqual(week?[1].title, "Long run")
        XCTAssertEqual(week?[0].isToday, true)
        XCTAssertEqual(week?[1].isToday, false)
    }

    func testNotLiveWithNoLoggedActivityHidesTheWeekBandEntirely() {
        let input = WorkoutsPageSelector.Input(
            currentWeek: nil, availability: nil, templates: [], sessionsForToday: [:],
            loggedActivities: [], today: "2026-09-09"
        )
        let selection = WorkoutsPageSelector.select(input)
        XCTAssertEqual(selection.today, .none)
        XCTAssertNil(selection.week)
    }

    func testNotLiveWithLoggedActivityShowsOnlyThatIsoWeek() {
        let entry = SyncCacheEntry(
            fileName: "2026-09-08_run.json", name: "Morning run", sportType: "Run",
            startDateLocal: "2026-09-08T07:00:00", elapsedTime: 1800, hasDescription: true
        )
        let input = WorkoutsPageSelector.Input(
            currentWeek: nil, availability: nil, templates: [], sessionsForToday: [:],
            loggedActivities: [entry], today: "2026-09-09"
        )
        let week = WorkoutsPageSelector.select(input).week
        XCTAssertNotNil(week, "logged activity this ISO week must not hide the band")
        XCTAssertEqual(week?.count, 7)
        let tuesday = week?.first { $0.date == "2026-09-08" }
        XCTAssertEqual(tuesday?.isFilled, true)
        XCTAssertEqual(tuesday?.title, "Morning run")
        XCTAssertEqual(tuesday?.discipline, .run)
        let monday = week?.first { $0.date == "2026-09-07" }
        XCTAssertEqual(monday?.isFilled, false)
    }

    // MARK: - mondayOfWeek

    func testMondayOfWeekOnAMondayIsItself() {
        XCTAssertEqual(WorkoutsPageSelector.mondayOfWeek(containing: "2026-09-07"), "2026-09-07")
    }

    func testMondayOfWeekOnASundayIsThePreviousMonday() {
        XCTAssertEqual(WorkoutsPageSelector.mondayOfWeek(containing: "2026-09-13"), "2026-09-07")
    }
}
