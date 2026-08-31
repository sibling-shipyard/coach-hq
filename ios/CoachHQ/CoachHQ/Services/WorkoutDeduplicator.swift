import Foundation

/// A workout reduced to the handful of fields deduplication actually needs.
///
/// The dedup rules live behind this type rather than `HKWorkout` for one reason: HealthKit
/// samples cannot be constructed outside a real device store, so anything that touches
/// `HKWorkout` directly is untestable. Kept Foundation-only so
/// `ios/scripts/verify_workout_dedup.swift` can compile it with the plain `swiftc` CLI.
struct DedupCandidate: Equatable {
    /// `HKWorkout.uuid.uuidString` — the canonical id (ADR 0014) when this is a live
    /// recording, or the committed file's `id` when this is a hist row.
    let uuid: String
    let sportType: String
    let start: Date
    let end: Date
    /// `ActivityMapper.sourcePriority` — apple 3 > garmin 2 > strava 1 > unknown 0.
    let sourcePriority: Int
    /// True when a file for this uuid (or one of its aliases) is already committed.
    let isCommitted: Bool
    /// Other HealthKit uuids already folded into this session (ADR 0035).
    let aliases: [String]

    init(
        uuid: String,
        sportType: String,
        start: Date,
        end: Date,
        sourcePriority: Int,
        isCommitted: Bool,
        aliases: [String] = []
    ) {
        self.uuid = uuid
        self.sportType = sportType
        self.start = start
        self.end = end
        self.sourcePriority = sourcePriority
        self.isCommitted = isCommitted
        self.aliases = aliases
    }

    var duration: TimeInterval { end.timeIntervalSince(start) }

    var identityUUIDs: Set<String> {
        Set(([uuid] + aliases).map { $0.uppercased() })
    }
}

/// Collapses the same real-world session recorded by several apps down to one activity.
///
/// Garmin Connect deletes a HealthKit workout and writes it again with a new uuid, so one
/// gym can appear as a committed file plus a live recording that no longer share an id.
/// Cluster live recordings together with committed hist rows; identity stays on the
/// committed file (ADR 0035).
enum WorkoutDeduplicator {

    /// Starts within this window still match even when Garmin and Strava disagree on sport.
    static let crossSportStartSlack: TimeInterval = 120

    /// One real-world session and every recording of it we found.
    struct Cluster: Equatable {
        /// The recording we keep — the one that gets committed, and whose stats the UI shows.
        let winner: DedupCandidate
        /// The other recordings of the same session, in the same rank order. Usually empty.
        let others: [DedupCandidate]

        /// Every recording in the cluster, winner first.
        var all: [DedupCandidate] { [winner] + others }

        /// True when any recording of this session is already committed — the honest answer
        /// to "do we have this session?". Ranking committed copies first means the winner is
        /// normally the committed one, but asking the whole cluster does not rely on that.
        var isSynced: Bool { all.contains(where: \.isCommitted) }
    }

    /// Groups recordings of the same session together and picks the one to keep from each.
    ///
    /// Winner order within a cluster:
    /// 1. **already committed** — whichever copy is in the repo stays, whatever its source.
    /// 2. **source priority** — apple > garmin > strava > unknown.
    /// 3. first encountered (input order) on a tie.
    ///
    /// Committed beats source priority because the alternative rewrites history: if the
    /// Strava copy syncs on Monday and the Garmin copy only reaches the phone on Wednesday,
    /// preferring Garmin would commit a *second* file for a session already in `hist/`.
    /// Keeping the committed copy is stable and never needs a delete. The live recording
    /// stays in `others` so sync can upsert HR into that file (ADR 0035).
    ///
    /// Grouping is greedy, not transitive: a recording joins the first winner it overlaps
    /// with, and starts its own cluster if it overlaps none. So a chain — A overlaps B,
    /// B overlaps C, A and C do not — splits rather than merging into one. That is
    /// deliberate. Transitive grouping lets a run of near-misses swallow genuinely separate
    /// back-to-back sessions, which is the worse failure: it would hide a real workout.
    static func cluster(_ candidates: [DedupCandidate]) -> [Cluster] {
        let ordered = candidates.enumerated().sorted { lhs, rhs in
            if lhs.element.isCommitted != rhs.element.isCommitted { return lhs.element.isCommitted }
            if lhs.element.sourcePriority != rhs.element.sourcePriority {
                return lhs.element.sourcePriority > rhs.element.sourcePriority
            }
            return lhs.offset < rhs.offset
        }

        var clusters: [(winner: DedupCandidate, others: [DedupCandidate])] = []
        for (_, candidate) in ordered {
            if let index = clusters.firstIndex(where: { areDuplicates(candidate, $0.winner) }) {
                clusters[index].others.append(candidate)
            } else {
                clusters.append((winner: candidate, others: []))
            }
        }
        return clusters.map { Cluster(winner: $0.winner, others: $0.others) }
    }

    /// Returns the uuids to keep, one per duplicate cluster. See `cluster(_:)` for the rules.
    static func selectWinners(_ candidates: [DedupCandidate]) -> [String] {
        cluster(candidates).map(\.winner.uuid)
    }

    /// Two workouts are the same session when they share a uuid/alias, or their time
    /// windows overlap by at least half of the shorter duration and either the activity
    /// group matches or they started within `crossSportStartSlack`.
    static func areDuplicates(_ a: DedupCandidate, _ b: DedupCandidate) -> Bool {
        if !a.identityUUIDs.isDisjoint(with: b.identityUUIDs) { return true }
        guard overlappingEnough(a, b) else { return false }
        if sameActivityGroup(a.sportType, b.sportType) { return true }
        return abs(a.start.timeIntervalSince(b.start)) <= crossSportStartSlack
    }

    static func overlappingEnough(_ a: DedupCandidate, _ b: DedupCandidate) -> Bool {
        let overlapStart = max(a.start, b.start)
        let overlapEnd = min(a.end, b.end)
        guard overlapEnd > overlapStart else { return false }
        let overlap = overlapEnd.timeIntervalSince(overlapStart)
        let shorter = min(a.duration, b.duration)
        return shorter > 0 && overlap / shorter >= 0.5
    }

    /// Walk and Hiking are treated as the same activity group for dedup purposes
    /// since different apps commonly disagree on the type for the same outdoor session.
    static func sameActivityGroup(_ a: String, _ b: String) -> Bool {
        if a == b { return true }
        let walkHike: Set<String> = ["Walk", "Hiking"]
        return walkHike.contains(a) && walkHike.contains(b)
    }
}
