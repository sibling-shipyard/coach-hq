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
    case tennis

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
    case tennis

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
    /// Expected Sunday load for the dashed cap. Absent on today's snapshots.
    let projectedSundayLoad: Double?
    /// Band eight weeks ago, for `+N% VS 8W AGO`. Absent on today's snapshots.
    let band8wAgoLow: Double?
    let band8wAgoHigh: Double?

    enum CodingKeys: String, CodingKey {
        case weekLabel, load, signal, verdict, compactVerdict, openVerdict
        case bandLow, bandHigh, scaleLow, scaleHigh, trend, mix, totalHours, method, doseRows
        case projectedSundayLoad, band8wAgoLow, band8wAgoHigh
    }

    init(
        weekLabel: String,
        load: Double,
        signal: String,
        verdict: String,
        compactVerdict: String?,
        openVerdict: String?,
        bandLow: Double?,
        bandHigh: Double?,
        scaleLow: Double,
        scaleHigh: Double,
        trend: [TrendPointSnapshot],
        mix: [LoadMixSnapshot],
        totalHours: Double,
        method: String,
        doseRows: [DoseRowSnapshot],
        projectedSundayLoad: Double? = nil,
        band8wAgoLow: Double? = nil,
        band8wAgoHigh: Double? = nil
    ) {
        self.weekLabel = weekLabel
        self.load = load
        self.signal = signal
        self.verdict = verdict
        self.compactVerdict = compactVerdict
        self.openVerdict = openVerdict
        self.bandLow = bandLow
        self.bandHigh = bandHigh
        self.scaleLow = scaleLow
        self.scaleHigh = scaleHigh
        self.trend = trend
        self.mix = mix
        self.totalHours = totalHours
        self.method = method
        self.doseRows = doseRows
        self.projectedSundayLoad = projectedSundayLoad
        self.band8wAgoLow = band8wAgoLow
        self.band8wAgoHigh = band8wAgoHigh
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        weekLabel = try container.decode(String.self, forKey: .weekLabel)
        load = try container.decode(Double.self, forKey: .load)
        signal = try container.decode(String.self, forKey: .signal)
        verdict = try container.decode(String.self, forKey: .verdict)
        compactVerdict = try container.decodeIfPresent(String.self, forKey: .compactVerdict)
        openVerdict = try container.decodeIfPresent(String.self, forKey: .openVerdict)
        bandLow = try container.decodeIfPresent(Double.self, forKey: .bandLow)
        bandHigh = try container.decodeIfPresent(Double.self, forKey: .bandHigh)
        scaleLow = try container.decode(Double.self, forKey: .scaleLow)
        scaleHigh = try container.decode(Double.self, forKey: .scaleHigh)
        trend = try container.decode([TrendPointSnapshot].self, forKey: .trend)
        mix = try container.decode([LoadMixSnapshot].self, forKey: .mix)
        totalHours = try container.decode(Double.self, forKey: .totalHours)
        method = try container.decode(String.self, forKey: .method)
        doseRows = try container.decode([DoseRowSnapshot].self, forKey: .doseRows)
        projectedSundayLoad = try container.decodeIfPresent(Double.self, forKey: .projectedSundayLoad)
        band8wAgoLow = try container.decodeIfPresent(Double.self, forKey: .band8wAgoLow)
        band8wAgoHigh = try container.decodeIfPresent(Double.self, forKey: .band8wAgoHigh)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(weekLabel, forKey: .weekLabel)
        try container.encode(load, forKey: .load)
        try container.encode(signal, forKey: .signal)
        try container.encode(verdict, forKey: .verdict)
        try container.encodeIfPresent(compactVerdict, forKey: .compactVerdict)
        try container.encodeIfPresent(openVerdict, forKey: .openVerdict)
        try container.encodeIfPresent(bandLow, forKey: .bandLow)
        try container.encodeIfPresent(bandHigh, forKey: .bandHigh)
        try container.encode(scaleLow, forKey: .scaleLow)
        try container.encode(scaleHigh, forKey: .scaleHigh)
        try container.encode(trend, forKey: .trend)
        try container.encode(mix, forKey: .mix)
        try container.encode(totalHours, forKey: .totalHours)
        try container.encode(method, forKey: .method)
        try container.encode(doseRows, forKey: .doseRows)
        try container.encodeIfPresent(projectedSundayLoad, forKey: .projectedSundayLoad)
        try container.encodeIfPresent(band8wAgoLow, forKey: .band8wAgoLow)
        try container.encodeIfPresent(band8wAgoHigh, forKey: .band8wAgoHigh)
    }

    var withEmptyDose: EngineSnapshot {
        EngineSnapshot(
            weekLabel: weekLabel,
            load: load,
            signal: signal,
            verdict: verdict,
            compactVerdict: compactVerdict,
            openVerdict: openVerdict,
            bandLow: bandLow,
            bandHigh: bandHigh,
            scaleLow: scaleLow,
            scaleHigh: scaleHigh,
            trend: trend,
            mix: mix,
            totalHours: totalHours,
            method: method,
            doseRows: [],
            projectedSundayLoad: projectedSundayLoad,
            band8wAgoLow: band8wAgoLow,
            band8wAgoHigh: band8wAgoHigh
        )
    }
}

/// WidgetKit / glance size — number + band strip only.
struct EngineSnapshotS: Codable {
    let weekLabel: String
    let load: Double
    let signal: String
    let compactVerdict: String
    let bandLow: Double?
    let bandHigh: Double?

    init(
        weekLabel: String,
        load: Double,
        signal: String,
        compactVerdict: String,
        bandLow: Double?,
        bandHigh: Double?
    ) {
        self.weekLabel = weekLabel
        self.load = load
        self.signal = signal
        self.compactVerdict = compactVerdict
        self.bandLow = bandLow
        self.bandHigh = bandHigh
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        weekLabel = try container.decode(String.self, forKey: .weekLabel)
        load = try container.decode(Double.self, forKey: .load)
        signal = try container.decode(String.self, forKey: .signal)
        compactVerdict = try container.decodeIfPresent(String.self, forKey: .compactVerdict) ?? "—"
        bandLow = try container.decodeIfPresent(Double.self, forKey: .bandLow)
        bandHigh = try container.decodeIfPresent(Double.self, forKey: .bandHigh)
    }
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

struct CoachMessageSnapshot: Codable, Equatable, Hashable {
    let id: String
    let createdAt: String
    let body: String
    let conversationSeedId: String

    enum CodingKeys: String, CodingKey {
        case id
        case createdAt = "created_at"
        case body
        case conversationSeedId = "conversation_seed_id"
    }
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
    let coachMessage: CoachMessageSnapshot?
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

    /// Older pipeline output (pre-WidgetKit `sizes` block) only ships `home`. Mirror the TS
    /// builder in `warmHomeSnapshots.ts` so Home can still render from legacy JSON.
    static func derived(from home: WarmHomeSnapshots) -> WidgetSizes {
        let engine = home.engine
        let quest = home.quest
        let questProgress = quest.target > 0
            ? min(100, (quest.completed / quest.target) * 100)
            : 0
        let defaultCommitment = CommitmentSnapshot(
            id: "badminton",
            label: "Badminton",
            glyph: .badminton,
            value: 0,
            target: 2,
            note: "NO DATA",
            status: "ALL",
            progress: 0,
            accent: "#315a4a",
            alarm: nil,
            allRecord: nil,
            rankedRecord: nil,
            hasRankedRecord: nil,
            latest: nil,
            latestRanked: nil,
            streak: nil
        )
        let commitmentS = home.commitments.first(where: { $0.id == "badminton" })
            ?? home.commitments.first
            ?? defaultCommitment

        return WidgetSizes(
            engine: EngineSizes(
                S: EngineSnapshotS(
                    weekLabel: engine.weekLabel,
                    load: engine.load,
                    signal: engine.signal,
                    compactVerdict: engine.compactVerdict ?? engine.verdict,
                    bandLow: engine.bandLow,
                    bandHigh: engine.bandHigh
                ),
                M: engine,
                L: engine
            ),
            quest: QuestSizes(
                S: QuestSnapshotS(
                    name: quest.name,
                    completed: quest.completed,
                    target: quest.target,
                    progressPercent: questProgress
                ),
                M: quest
            ),
            commitments: CommitmentSizes(S: commitmentS, M: home.commitments)
        )
    }
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

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        generatedAt = try container.decode(String.self, forKey: .generatedAt)
        home = try container.decode(WarmHomeSnapshots.self, forKey: .home)
        sizes = try container.decodeIfPresent(WidgetSizes.self, forKey: .sizes) ?? WidgetSizes.derived(from: home)
    }

    /// Human-readable decode failure for surfacing in Home's error toast.
    static func decodingErrorDescription(_ error: Error) -> String {
        switch error {
        case let DecodingError.keyNotFound(key, context):
            return "missing \"\(key.stringValue)\" at \(context.codingPath.map(\.stringValue).joined(separator: "."))"
        case let DecodingError.typeMismatch(type, context):
            return "wrong type for \(type) at \(context.codingPath.map(\.stringValue).joined(separator: "."))"
        case let DecodingError.valueNotFound(type, context):
            return "missing value for \(type) at \(context.codingPath.map(\.stringValue).joined(separator: "."))"
        default:
            return error.localizedDescription
        }
    }
}
