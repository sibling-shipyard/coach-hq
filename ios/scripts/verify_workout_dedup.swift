import Foundation

// Standalone verification harness for WorkoutDeduplicator.swift.
//
// There is no Xcode test target in this project, so this is plain assertions run via the
// `swift`/`swiftc` CLI directly against the app's WorkoutDeduplicator.swift — the same
// pattern as verify_description_parser.swift.
//
// Usage:
//   swiftc ios/CoachHQ/CoachHQ/Services/WorkoutDeduplicator.swift \
//          ios/scripts/verify_workout_dedup.swift \
//          -o /tmp/verify_dedup && /tmp/verify_dedup

final class TestRunner {
    private(set) var passed = 0
    private(set) var failed = 0
    private var failures: [String] = []

    func check(_ name: String, _ condition: @autoclosure () -> Bool) {
        if condition() {
            passed += 1
            print("PASS: \(name)")
        } else {
            failed += 1
            failures.append(name)
            print("FAIL: \(name)")
        }
    }

    func summary() -> Bool {
        print("\n\(passed) passed, \(failed) failed out of \(passed + failed)")
        if !failures.isEmpty {
            print("Failures:")
            for f in failures { print("  - \(f)") }
        }
        return failed == 0
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────
private let reference = Date(timeIntervalSince1970: 1_787_000_000)  // fixed, timezone-free

private func at(_ hoursFromReference: Double, minutes: Double = 60) -> (Date, Date) {
    let start = reference.addingTimeInterval(hoursFromReference * 3600)
    return (start, start.addingTimeInterval(minutes * 60))
}

private let apple = 3, garmin = 2, strava = 1

private func candidate(
    _ uuid: String,
    _ sport: String,
    _ window: (Date, Date),
    source: Int,
    committed: Bool = false
) -> DedupCandidate {
    DedupCandidate(
        uuid: uuid,
        sportType: sport,
        start: window.0,
        end: window.1,
        sourcePriority: source,
        isCommitted: committed
    )
}

@main
struct Verify {
    static func main() {
        let t = TestRunner()

        // ── Test 1: distinct sessions are all kept (the late-arrival case) ──
        // The 14-day window re-scans days that are already synced, so a round routinely
        // holds a mix of committed and brand-new workouts. Nothing may be dropped just
        // for sitting in the same batch.
        do {
            let morning = candidate("A", "WeightTraining", at(0), source: apple, committed: true)
            let evening = candidate("B", "WeightTraining", at(8), source: apple)
            let winners = Set(WorkoutDeduplicator.selectWinners([morning, evening]))
            t.check("test_01: committed morning session kept", winners.contains("A"))
            t.check("test_01: late-arriving evening session kept", winners.contains("B"))
            t.check("test_01: nothing else invented", winners.count == 2)
        }

        // ── Test 2: same session from two sources collapses to one ──────────
        // Garmin and Strava both mirror the same Apple Watch ride into HealthKit.
        do {
            let window = at(0, minutes: 60)
            let a = candidate("APPLE", "Ride", window, source: apple)
            let g = candidate("GARMIN", "Ride", window, source: garmin)
            let s = candidate("STRAVA", "Ride", window, source: strava)
            let winners = WorkoutDeduplicator.selectWinners([s, g, a])
            t.check("test_02: collapses to one", winners.count == 1)
            t.check("test_02: highest-priority source wins", winners.first == "APPLE")
        }

        // ── Test 3: the copy already in the repo wins, whatever its source ──
        // Strava's copy synced on Monday; Garmin's copy only reaches the phone on
        // Wednesday. Preferring Garmin would commit a second file for one session.
        do {
            let window = at(0, minutes: 60)
            let committedStrava = candidate("STRAVA", "Ride", window, source: strava, committed: true)
            let lateGarmin = candidate("GARMIN", "Ride", window, source: garmin)
            let winners = WorkoutDeduplicator.selectWinners([lateGarmin, committedStrava])
            t.check("test_03: still one activity", winners.count == 1)
            t.check("test_03: committed copy wins over higher priority", winners.first == "STRAVA")
        }

        // ── Test 4: dedup is stable across rounds ───────────────────────────
        // Same batch, run again after the winner was committed — the answer must not move,
        // or every sync round would commit a different copy of the same session.
        do {
            let window = at(0, minutes: 60)
            let firstRound = WorkoutDeduplicator.selectWinners([
                candidate("GARMIN", "Ride", window, source: garmin),
                candidate("STRAVA", "Ride", window, source: strava),
            ])
            let secondRound = WorkoutDeduplicator.selectWinners([
                candidate("GARMIN", "Ride", window, source: garmin, committed: true),
                candidate("STRAVA", "Ride", window, source: strava),
            ])
            t.check("test_04: first round picks garmin", firstRound == ["GARMIN"])
            t.check("test_04: second round is unchanged", secondRound == firstRound)
        }

        // ── Test 5: overlap threshold ───────────────────────────────────────
        do {
            let base = candidate("A", "Ride", at(0, minutes: 60), source: apple)
            let halfOverlap = candidate("B", "Ride", at(0.5, minutes: 60), source: strava)
            let slightOverlap = candidate("C", "Ride", at(0.9, minutes: 60), source: strava)
            let backToBack = candidate("D", "Ride", at(1, minutes: 60), source: strava)
            t.check("test_05: 50% overlap is a duplicate",
                    WorkoutDeduplicator.areDuplicates(base, halfOverlap))
            t.check("test_05: 10% overlap is not",
                    !WorkoutDeduplicator.areDuplicates(base, slightOverlap))
            t.check("test_05: touching but not overlapping is not",
                    !WorkoutDeduplicator.areDuplicates(base, backToBack))
        }

        // ── Test 6: activity grouping ───────────────────────────────────────
        do {
            let window = at(0, minutes: 60)
            let walk = candidate("W", "Walk", window, source: apple)
            let hike = candidate("H", "Hiking", window, source: strava)
            let ride = candidate("R", "Ride", window, source: strava)
            t.check("test_06: walk and hiking are one group",
                    WorkoutDeduplicator.areDuplicates(walk, hike))
            t.check("test_06: walk and ride are not",
                    !WorkoutDeduplicator.areDuplicates(walk, ride))
            t.check("test_06: overlapping different sports both kept",
                    WorkoutDeduplicator.selectWinners([walk, ride]).count == 2)
        }

        // ── Test 7: ties keep input order ───────────────────────────────────
        do {
            let window = at(0, minutes: 60)
            let first = candidate("FIRST", "Yoga", window, source: 0)
            let second = candidate("SECOND", "Yoga", window, source: 0)
            t.check("test_07: tie keeps the first encountered",
                    WorkoutDeduplicator.selectWinners([first, second]) == ["FIRST"])
        }

        // ── Test 8: zero-duration workouts never swallow a real one ─────────
        do {
            let empty = candidate("EMPTY", "Ride", at(0, minutes: 0), source: apple)
            let real = candidate("REAL", "Ride", at(0, minutes: 60), source: strava)
            t.check("test_08: both kept", WorkoutDeduplicator.selectWinners([empty, real]).count == 2)
        }

        exit(t.summary() ? 0 : 1)
    }
}
