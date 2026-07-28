import WidgetKit
import SwiftUI

/// Unlike Engine/Quest/Commitment, the snapshot schema has no separate `sizes.trainingActivity`
/// (S/M) split — there's one `home.trainingActivity: TrainingActivitySnapshot` shape, same as
/// the in-app M-size card. This widget just renders a smaller slice of the same already-decoded
/// fields per family; no new pipeline analytics needed (ADR 0005 still holds — nothing here is
/// derived, only displayed).
struct TrainingActivityEntry: TimelineEntry {
    let date: Date
    let activity: TrainingActivitySnapshot?
    let isPlaceholder: Bool
}

struct TrainingActivityProvider: TimelineProvider {
    /// See `EngineProvider.sampleSizes` — same reasoning: a plausible mixed month (not all
    /// `.empty`) so the gallery preview actually shows the sport-colored grid, not a blank block.
    private static var sampleSnapshot: TrainingActivitySnapshot {
        let pattern: [ActivityCellState] = [
            .badminton, .empty, .foundation, .empty, .empty, .cycling, .empty,
            .empty, .badminton, .empty, .foundation, .empty, .run, .empty,
            .plannedMissed, .empty, .badminton, .empty, .foundation, .empty, .empty,
            .cycling, .empty, .badminton, .empty, .foundation, .empty, .empty,
        ]
        let month = ActivityMonthSnapshot(label: "JUL", cells: pattern, dates: nil)
        return TrainingActivitySnapshot(
            rangeLabel: "Last 4 months", months: [month], longestBlock: 5, activeDays: 12,
            planTruePercent: 78, gapCount: 2, worstGap: 3,
            read: "Gaps follow big match days — consistency holds otherwise.", dayDetails: nil
        )
    }

    func placeholder(in context: Context) -> TrainingActivityEntry {
        TrainingActivityEntry(date: Date(), activity: Self.sampleSnapshot, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (TrainingActivityEntry) -> Void) {
        if context.isPreview {
            completion(TrainingActivityEntry(date: Date(), activity: Self.sampleSnapshot, isPlaceholder: false))
            return
        }
        completion(TrainingActivityEntry(date: Date(), activity: AppGroupSnapshotBridge.read()?.home.trainingActivity, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TrainingActivityEntry>) -> Void) {
        let entry = TrainingActivityEntry(date: Date(), activity: AppGroupSnapshotBridge.read()?.home.trainingActivity, isPlaceholder: false)
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct TrainingActivityWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TrainingActivityEntry

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 2), count: 7)

    var body: some View {
        Group {
            if let activity = entry.activity, let month = activity.months.last {
                switch family {
                case .systemMedium:
                    mediumContent(activity, month)
                default:
                    smallContent(activity, month)
                }
            } else {
                EmptyGlanceView(label: "ACTIVITY", message: "No training activity logged yet")
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.paper }
    }

    /// S — grid only, plus a single stat. No weekday labels, no legend, no read text —
    /// "cell size may shrink; the sport-color language may not."
    private func smallContent(_ activity: TrainingActivitySnapshot, _ month: ActivityMonthSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            MonoLabel("ACTIVITY · \(month.label)")
            grid(month)
            Text("\(activity.longestBlock)D LONGEST BLOCK")
                .font(.system(size: 8, weight: .bold, design: .monospaced))
                .foregroundColor(WarmInstrument.inkMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// M — grid + weekday header + the 3-stat row + a 1-line read, matching the in-app M
    /// card minus the month-paging controls (glance-only, zero interaction here).
    private func mediumContent(_ activity: TrainingActivitySnapshot, _ month: ActivityMonthSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            MonoLabel("ACTIVITY · \(month.label)")
            grid(month)
            HStack(spacing: 14) {
                stat("\(activity.longestBlock)D", "BLOCK")
                stat(activity.planTruePercent.map { "\(Int($0))%" } ?? "—", "PLAN-TRUE")
                stat("\(activity.gapCount)", "GAPS")
            }
            Text(activity.read)
                .font(.system(size: 10))
                .foregroundColor(WarmInstrument.inkMuted)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func grid(_ month: ActivityMonthSnapshot) -> some View {
        LazyVGrid(columns: columns, spacing: 2) {
            ForEach(Array(month.cells.enumerated()), id: \.offset) { _, cell in
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(cellColor(cell))
                    .aspectRatio(1, contentMode: .fit)
            }
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value)
                .font(WarmInstrument.figures(11, weight: .bold))
                .foregroundColor(WarmInstrument.ink)
            Text(label)
                .font(.system(size: 7, weight: .bold, design: .monospaced))
                .foregroundColor(WarmInstrument.inkFaint)
        }
    }

    private func cellColor(_ cell: ActivityCellState) -> Color {
        switch cell {
        case .empty: return WarmInstrument.border
        case .plannedMissed: return WarmInstrument.alarmBg
        default:
            guard let sport = WarmSportId(rawValue: cell.rawValue) else { return WarmInstrument.inkFaint }
            return WarmInstrument.sportColor(sport)
        }
    }
}

struct TrainingActivityWidget: Widget {
    let kind = "com.coachhq.ios.widget.trainingActivity"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TrainingActivityProvider()) { entry in
            TrainingActivityWidgetView(entry: entry)
        }
        .configurationDisplayName("Training Activity")
        .description("This month's consistency, at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
