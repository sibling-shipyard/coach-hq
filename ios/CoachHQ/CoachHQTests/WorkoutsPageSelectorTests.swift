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
        durationMin: Int? = 30,
        completionIds: [String] = []
    ) -> CurrentWeekSession {
        CurrentWeekSession(
            id: id, origin: .planned, discipline: discipline, kind: "strength", title: title,
            priority: .anchor, status: status, plannedDurationMin: durationMin,
            templateId: templateId, sessionFile: sessionFile, coachNote: nil,
            originalDate: nil, completionActivityIds: completionIds
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

    private func input(
        currentWeek: CurrentWeek? = nil,
        availability: CurrentWeekAvailability? = nil,
        templates: [Workout] = [],
        sessionsForDate: [String: Workout] = [:],
        loggedActivities: [SyncCacheEntry] = [],
        loadHints: WorkoutsPageSelector.LoadHints = .init(),
        today: String
    ) -> WorkoutsPageSelector.Input {
        WorkoutsPageSelector.Input(
            currentWeek: currentWeek,
            availability: availability,
            templates: templates,
            sessionsForDate: sessionsForDate,
            loggedActivities: loggedActivities,
            loadHints: loadHints,
            today: today
        )
    }

    // MARK: - Today band

    func testTodayWithNoSessionIsRest() {
        let plan = week(days: [day(date: "2026-09-09")])
        let selection = WorkoutsPageSelector.select(input(currentWeek: plan, availability: live, today: "2026-09-09"))
        XCTAssertEqual(selection.today, .rest)
        XCTAssertEqual(selection.week?.days.first { $0.date == "2026-09-09" }?.isRest, true)
    }

    func testLiveSessionWithNoTemplateIdIsAMentionNeverRest() {
        let plan = week(days: [day(date: "2026-09-09", sessions: [
            currentWeekSession(title: "Badminton match", templateId: nil, durationMin: 60),
        ])])
        let selection = WorkoutsPageSelector.select(input(currentWeek: plan, availability: live, today: "2026-09-09"))
        guard case .mention(let title, let duration) = selection.today else {
            return XCTFail("expected .mention")
        }
        XCTAssertEqual(title, "Badminton match")
        XCTAssertEqual(duration, 60)
        let session = selection.week?.days.first { $0.date == "2026-09-09" }?.sessions.first
        XCTAssertEqual(session?.isMatchDraft, true)
        XCTAssertNil(session?.load, "draft load stays blank — planned_load is gone")
    }

    func testLiveSessionResolvesToTemplateWhenNoCoachSessionFileExists() {
        let plan = week(days: [day(date: "2026-09-09", sessions: [currentWeekSession()])])
        let selection = WorkoutsPageSelector.select(input(
            currentWeek: plan, availability: live, templates: [template()], today: "2026-09-09"
        ))
        guard case .runnable(let workout, let isSession, let done) = selection.today else {
            return XCTFail("expected .runnable")
        }
        XCTAssertEqual(workout.id, "tmpl_a")
        XCTAssertFalse(isSession)
        XCTAssertFalse(done)
        XCTAssertEqual(selection.week?.days.first { $0.date == "2026-09-09" }?.sessions.first?.isProtocol, true)
    }

    func testLiveSessionPrefersCoachAdjustedSessionFileOverTemplate() {
        let plan = week(days: [day(date: "2026-09-09", sessions: [
            currentWeekSession(status: .done, sessionFile: "user_data/activities/workout_plans/sessions/2026-09-09_tmpl_a.json"),
        ])])
        let sessions = ["tmpl_a": session(id: "tmpl_a", templateId: "tmpl_a", date: "2026-09-09")]
        let selection = WorkoutsPageSelector.select(input(
            currentWeek: plan, availability: live, templates: [template()], sessionsForDate: sessions, today: "2026-09-09"
        ))
        guard case .runnable(let workout, let isSession, let done) = selection.today else {
            return XCTFail("expected .runnable")
        }
        XCTAssertEqual(workout.title, "Coach-adjusted")
        XCTAssertTrue(isSession)
        XCTAssertTrue(done, "session already marked done stays runnable, badged done")
    }

    // MARK: - Week

    func testWeekDaysFillFromThePlanRegardlessOfWhichDayIsToday() {
        let plan = week(days: [
            day(date: "2026-09-07"),
            day(date: "2026-09-08", sessions: [currentWeekSession(title: "Long run", durationMin: 45)]),
        ])
        let week = WorkoutsPageSelector.select(input(currentWeek: plan, availability: live, today: "2026-09-07")).week
        XCTAssertEqual(week?.days[0].isRest, true, "blank day is rest, not a missing row")
        XCTAssertEqual(week?.days[1].isRest, false)
        XCTAssertEqual(week?.days[1].sessions.first?.title, "Long run")
        XCTAssertEqual(week?.days[0].isToday, true)
        XCTAssertEqual(week?.days[1].isToday, false)
        XCTAssertEqual(week?.number, 37)
    }

    func testTwoSessionsOnOneDayBothSurvive() {
        let plan = week(days: [day(date: "2026-09-09", sessions: [
            currentWeekSession(id: "a", title: "Kickstart"),
            currentWeekSession(id: "b", discipline: .badminton, title: "Match", templateId: nil),
        ])])
        let day = WorkoutsPageSelector.select(input(
            currentWeek: plan, availability: live, templates: [template()], today: "2026-09-09"
        )).week?.days.first { $0.date == "2026-09-09" }
        XCTAssertEqual(day?.sessions.map(\.id), ["a", "b"])
        XCTAssertEqual(WorkoutsPageSelector.defaultFocusIndex(in: day!), 0)
    }

    func testNotLiveWithNoLoggedActivityHidesTheWeekBandEntirely() {
        let selection = WorkoutsPageSelector.select(input(today: "2026-09-09"))
        XCTAssertEqual(selection.today, .none)
        XCTAssertNil(selection.week)
    }

    func testNotLiveWithLoggedActivityShowsOnlyThatIsoWeek() {
        let entry = SyncCacheEntry(
            fileName: "2026-09-08_run.json", name: "Morning run", sportType: "Run",
            startDateLocal: "2026-09-08T07:00:00", elapsedTime: 1800, hasDescription: true
        )
        let week = WorkoutsPageSelector.select(input(loggedActivities: [entry], today: "2026-09-09")).week
        XCTAssertNotNil(week, "logged activity this ISO week must not hide the band")
        XCTAssertEqual(week?.days.count, 7)
        let tuesday = week?.days.first { $0.date == "2026-09-08" }
        XCTAssertEqual(tuesday?.isRest, false)
        XCTAssertEqual(tuesday?.sessions.first?.title, "Morning run")
        XCTAssertEqual(tuesday?.sessions.first?.sport, .run)
        XCTAssertEqual(tuesday?.sessions.first?.status, .logged)
        let monday = week?.days.first { $0.date == "2026-09-07" }
        XCTAssertEqual(monday?.isRest, true)
    }

    func testSnapshotLoadHintsFillLoggedFiguresAndBand() {
        let plan = week(days: [
            day(date: "2026-09-07", sessions: [
                currentWeekSession(status: .done, completionIds: ["healthkit:abc"]),
            ]),
        ])
        let entry = SyncCacheEntry(
            fileName: "2026-09-07_fdn.json", name: "Foundation A", sportType: "WeightTraining",
            startDateLocal: "2026-09-07T07:00:00", elapsedTime: 1800, hasDescription: true
        )
        var hinted = entry
        // activityId join needs a payload; load itself comes from the snapshot hint.
        let hints = WorkoutsPageSelector.LoadHints(loadByDate: ["2026-09-07": 61], bandLow: 50, bandHigh: 80)
        let week = WorkoutsPageSelector.select(input(
            currentWeek: plan, availability: live, loggedActivities: [hinted], loadHints: hints, today: "2026-09-09"
        )).week
        XCTAssertEqual(week?.loggedLoad, 61)
        XCTAssertEqual(week?.bandVerdict, "in the band")
        XCTAssertEqual(week?.days.first?.observedLoad, 61)
    }

    // MARK: - mondayOfWeek

    func testMondayOfWeekOnAMondayIsItself() {
        XCTAssertEqual(WorkoutsPageSelector.mondayOfWeek(containing: "2026-09-07"), "2026-09-07")
    }

    func testMondayOfWeekOnASundayIsThePreviousMonday() {
        XCTAssertEqual(WorkoutsPageSelector.mondayOfWeek(containing: "2026-09-13"), "2026-09-07")
    }
}
