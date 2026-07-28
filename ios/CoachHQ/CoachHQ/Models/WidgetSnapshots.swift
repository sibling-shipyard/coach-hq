import Foundation

/// Codable mirror of `ui/client/src/components/home-warm/snapshots.ts` — the cross-platform
/// contract established by ADR 0005. TypeScript models remain the source of truth; this file
/// only decodes what the pipeline already computed into `gen/widget_snapshots.json`. No
/// analytics logic is duplicated here — see `kdb/decisions/0005-widget-snapshots-cross-platform.md`.

// MARK: - Sport / glyph identifiers

/// Mirrors `WarmSportId`. Falls back to `.other` for forward compatibility if the pipeline
/// ever adds a sport this build doesn't know about yet — never fails to decode the file.
enum WarmSportId: String, Codable {
    case cycling, badminton, calisthenics, foundation, run, other
    case strength, weightTraining = "weight_training"
    case hike, walk, cricket, football, workout, swim

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = WarmSportId(rawValue: raw) ?? .other
    }
}

/// Mirrors `ActivityGlyphKind` (`WarmSportId` plus `"recovery"`).
enum ActivityGlyphKind: String, Codable {
    case cycling, badminton, calisthenics, foundation, run, recovery, other
    case strength, weightTraining = "weight_training"
    case hike, walk, cricket, football, workout, swim

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ActivityGlyphKind(rawValue: raw) ?? .other
    }
}

/// Mirrors `ActivityCellState` (`WarmSportId` plus `"empty"` / `"planned-missed"`).
enum ActivityCellState: String, Codable {
    case empty
    case badminton, calisthenics, foundation, cycling, run
    case strength, weightTraining = "weight_training"
    case hike, walk, cricket, football, workout, swim
    case plannedMissed = "planned-missed"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ActivityCellState(rawValue: raw) ?? .empty
    }
}

// MARK: - Shared leaves

struct ActivityInspectionSnapshot: Codable, Identifiable {
    let id: String
    let dateKey: String
    let dateLabel: String
    let title: String
    let sport: WarmSportId
    let ranked: Bool
    let durationMinutes: Double
    let calories: Double?
    let averageHeartRate: Double?
    let maxHeartRate: Double?
    let distanceKm: Double?
    let load: Double?
    let source: String
}

struct TrendPointSnapshot: Codable, Identifiable {
    let label: String
    let value: Double
    let weekLabel: String?

    var id: String { label }
}

struct LoadMixSnapshot: Codable, Identifiable {
    let id: WarmSportId
    let label: String
    let shortLabel: String
    let hours: Double
    let color: String
}

struct DoseRowSnapshot: Codable, Identifiable {
    let day: String
    let title: String
    let detail: String?
    let load: Double?
    let sport: WarmSportId
    let isRest: Bool?

    var id: String { day + title }
}

// MARK: - Engine

struct EngineSnapshot: Codable {
    let weekLabel: String
    let load: Double
    let signal: String
    let verdict: String
    let compactVerdict: String?
    let openVerdict: String?
    let bandLow: Double?
    let bandHigh: Double?
    let scaleLow: Double
    let scaleHigh: Double
    let trend: [TrendPointSnapshot]
    let mix: [LoadMixSnapshot]
    let totalHours: Double
    let method: String
    let doseRows: [DoseRowSnapshot]
}

/// WidgetKit / glance size — number + band strip only.
struct EngineSnapshotS: Codable {
    let weekLabel: String
    let load: Double
    let signal: String
    let compactVerdict: String
    let bandLow: Double?
    let bandHigh: Double?
}

// MARK: - Quest

/// Not `Identifiable` — `id` from the JSON is optional; callers use `ForEach(_, id: \.name)`.
struct QuestSideSnapshot: Codable {
    let id: String?
    let name: String
    let value: Double
    let target: Double
    let color: String
    let notes: String?
}

struct QuestSnapshot: Codable {
    let name: String
    let completed: Double
    let target: Double
    let loaded: Double
    let daysLeft: Int
    let sideQuests: [QuestSideSnapshot]
    let streakLabel: String?
}

/// WidgetKit / glance size — title + fraction + bar.
struct QuestSnapshotS: Codable {
    let name: String
    let completed: Double
    let target: Double
    let progressPercent: Double
}

// MARK: - Coach's read

struct CoachReadSnapshot: Codable {
    let dateLabel: String
    let body: String
    let eyebrow: String?
    let signature: String?
    let actionLabel: String?
    let isPreview: Bool?
    let evidence: [String]?
}

// MARK: - Sport commitments

struct CommitmentSnapshot: Codable, Identifiable {
    let id: String
    let label: String
    let glyph: ActivityGlyphKind
    let value: Double
    let target: Double?
    let note: String
    let status: String
    let progress: Double?
    let accent: String
    let alarm: Bool?
    let allRecord: String?
    let rankedRecord: String?
    let hasRankedRecord: Bool?
    let latest: ActivityInspectionSnapshot?
    let latestRanked: ActivityInspectionSnapshot?
    let streak: Int?
}

// MARK: - Weekly plan

struct PlanDaySnapshot: Codable, Identifiable {
    let key: String
    let day: String
    let dayShort: String
    let glyph: ActivityGlyphKind?
    let sport: String // WarmSportId | "recovery" — kept as raw string, see `sportGlyph`
    let title: String
    let loadDelta: Double?
    let isRecorded: Bool?
    let href: String?
    let activities: [ActivityInspectionSnapshot]?

    var id: String { key }
}

struct WeeklyPlanSnapshot: Codable {
    let label: String
    let isPreview: Bool
    let title: String?
    let statusLabel: String?
    let bandLow: Double?
    let bandHigh: Double?
    let days: [PlanDaySnapshot]
}

// MARK: - Calories

struct CaloriesSnapshot: Codable {
    let monthLabel: String
    let current: Double
    let target: Double?
    let daysLeft: Int
    let daysInMonth: Int
    let pacePercent: Double
    let dailyActual: [Double]
    let dailyNeeded: Double?
    let targetIsFixture: Bool?
    let elapsedDays: Int?
    let activeDays: Int?
    let highestDayLabel: String?
    let highestDayCalories: Double?
}

// MARK: - Training activity heatmap

struct ActivityMonthSnapshot: Codable, Identifiable {
    let label: String
    let cells: [ActivityCellState]
    let dates: [String?]?

    var id: String { label }
}

struct DayDetailSnapshot: Codable {
    let dateLabel: String
    let activities: [ActivityInspectionSnapshot]
    let durationMinutes: Double
    let load: Double?
}

struct TrainingActivitySnapshot: Codable {
    let rangeLabel: String
    let months: [ActivityMonthSnapshot]
    let longestBlock: Int
    let activeDays: Int
    let planTruePercent: Double?
    let gapCount: Int
    let worstGap: Int
    let read: String
    let dayDetails: [String: DayDetailSnapshot]?
}

// MARK: - VO2

struct Vo2Snapshot: Codable {
    let status: String
    let value: Double?
    let delta: Double?
    let percentileLabel: String?
    let trend: [TrendPointSnapshot]
    let read: String

    var isAvailable: Bool { status == "available" && value != nil }
}

// MARK: - Recent sessions

struct RecentSessionSnapshot: Codable, Identifiable {
    let id: String
    let dateLabel: String
    let title: String
    let detail: String
    let load: Double?
    let sport: WarmSportId
    let href: String?
    let evidence: ActivityInspectionSnapshot?
}

// MARK: - Build phase

/// Not `Identifiable` — `id` from the JSON is optional; callers use `ForEach(_, id: \.name)`.
struct PhaseMilestoneSnapshot: Codable {
    let id: String?
    let name: String
    let baseline: String
    let current: String?
    let target: String
    let note: String?
    let progressPercent: Double?
    let projectedDateLabel: String?
}

struct BuildPhaseSnapshot: Codable {
    let weekLabel: String
    let title: String?
    let milestones: [PhaseMilestoneSnapshot]
    let read: String
}

// MARK: - Sync

struct WidgetSyncSnapshot: Codable {
    let label: String
    let healthy: Bool
    let status: String
    let timestamp: String?
    let warnings: [String]
}

// MARK: - Home aggregate

struct WarmHomeSnapshots: Codable {
    let engine: EngineSnapshot
    let quest: QuestSnapshot
    let coachRead: CoachReadSnapshot
    let commitments: [CommitmentSnapshot]
    let plan: WeeklyPlanSnapshot
    let calories: CaloriesSnapshot
    let trainingActivity: TrainingActivitySnapshot
    let vo2: Vo2Snapshot
    let sessions: [RecentSessionSnapshot]
    let phase: BuildPhaseSnapshot
    let activityEvidence: [ActivityInspectionSnapshot]
    let sync: WidgetSyncSnapshot
}

// MARK: - Sizes (WidgetKit-facing; decoded now, consumed by Phase 3)

struct EngineSizes: Codable {
    let S: EngineSnapshotS
    let M: EngineSnapshot
    let L: EngineSnapshot
}

struct QuestSizes: Codable {
    let S: QuestSnapshotS
    let M: QuestSnapshot
}

struct CommitmentSizes: Codable {
    let S: CommitmentSnapshot
    let M: [CommitmentSnapshot]
}

struct WidgetSizes: Codable {
    let engine: EngineSizes
    let quest: QuestSizes
    let commitments: CommitmentSizes
}

// MARK: - File root

struct WidgetSnapshotsFile: Codable {
    let schemaVersion: Int
    let generatedAt: String
    let home: WarmHomeSnapshots
    let sizes: WidgetSizes

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case generatedAt = "generated_at"
        case home
        case sizes
    }

    static func decodingErrorDescription(_ error: Error) -> String {
        switch error {
        case DecodingError.keyNotFound(let key, let context):
            let path = context.codingPath.map(\.stringValue).joined(separator: ".")
            return "missing key '\(key.stringValue)' at \(path.isEmpty ? "root" : path)"
        case DecodingError.typeMismatch(let type, let context):
            let path = context.codingPath.map(\.stringValue).joined(separator: ".")
            return "type mismatch for \(type) at \(path.isEmpty ? "root" : path)"
        default:
            return error.localizedDescription
        }
    }
}
