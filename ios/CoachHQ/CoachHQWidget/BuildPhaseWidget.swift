import WidgetKit
import SwiftUI

/// Same note as `TrainingActivityWidget` — no separate `sizes.phase` split in the schema, one
/// `home.phase: BuildPhaseSnapshot` shape reused at a smaller size.
struct BuildPhaseEntry: TimelineEntry {
    let date: Date
    let phase: BuildPhaseSnapshot?
    let isPlaceholder: Bool
}

struct BuildPhaseProvider: TimelineProvider {
    private static var previewPhase: BuildPhaseSnapshot { GoldenDataset.snapshots.home.phase }

    func placeholder(in context: Context) -> BuildPhaseEntry {
        BuildPhaseEntry(date: Date(), phase: Self.previewPhase, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (BuildPhaseEntry) -> Void) {
        if context.isPreview {
            completion(BuildPhaseEntry(date: Date(), phase: Self.previewPhase, isPlaceholder: false))
            return
        }
        completion(BuildPhaseEntry(date: Date(), phase: AppGroupSnapshotBridge.read()?.home.phase, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BuildPhaseEntry>) -> Void) {
        let entry = BuildPhaseEntry(date: Date(), phase: AppGroupSnapshotBridge.read()?.home.phase, isPlaceholder: false)
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct BuildPhaseWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: BuildPhaseEntry

    var body: some View {
        Group {
            if let phase = entry.phase {
                switch family {
                case .systemMedium:
                    mediumContent(phase)
                default:
                    smallContent(phase)
                }
            } else {
                EmptyGlanceView(label: "BUILD PHASE", message: "No block tracked yet")
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.paper }
    }

    /// S — the phase rail is the identity at every size; milestones only appear at M+.
    private func smallContent(_ phase: BuildPhaseSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                MonoLabel(phase.title ?? "BUILD PHASE", size: 8)
                Spacer()
                Text(phase.weekLabel)
                    .font(WarmInstrument.figures(10, weight: .bold))
                    .foregroundColor(WarmInstrument.accent)
            }
            rail
            Spacer(minLength: 0)
            Text(phase.read)
                .font(.system(size: 10))
                .foregroundColor(WarmInstrument.inkMuted)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// M — adds up to 2 milestones with their current→target readout.
    private func mediumContent(_ phase: BuildPhaseSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                MonoLabel(phase.title ?? "BUILD PHASE", size: 8)
                Spacer()
                Text(phase.weekLabel)
                    .font(WarmInstrument.figures(10, weight: .bold))
                    .foregroundColor(WarmInstrument.accent)
            }
            rail

            if phase.milestones.isEmpty {
                Text(phase.read)
                    .font(.system(size: 10))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .lineLimit(2)
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(phase.milestones.prefix(2), id: \.name) { milestone in
                        HStack(spacing: 4) {
                            Text(milestone.name)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundColor(WarmInstrument.ink)
                                .lineLimit(1)
                            Spacer()
                            Text(milestone.current ?? milestone.baseline)
                                .font(WarmInstrument.figures(10))
                                .foregroundColor(WarmInstrument.inkMuted)
                            Text("→")
                                .font(.system(size: 9))
                                .foregroundColor(WarmInstrument.inkFaint)
                            Text(milestone.target)
                                .font(WarmInstrument.figures(10, weight: .bold))
                                .foregroundColor(WarmInstrument.ink)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var rail: some View {
        HStack(spacing: 3) {
            // Block 1 — active
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(WarmInstrument.accent)
                .frame(height: 4)
            // Deload
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(Color(red: 0xe0 / 255, green: 0xb0 / 255, blue: 0x6e / 255))
                .frame(height: 4)
            // Block 2 — upcoming
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .strokeBorder(Color(red: 0xc9 / 255, green: 0xc2 / 255, blue: 0xb2 / 255), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .frame(height: 4)
            // Test week
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .strokeBorder(WarmInstrument.accent.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .frame(height: 4)
        }
    }
}

struct BuildPhaseWidget: Widget {
    let kind = "com.siblingshipyard.coachhq.widget.buildPhase"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BuildPhaseProvider()) { entry in
            BuildPhaseWidgetView(entry: entry)
        }
        .configurationDisplayName("Build Phase")
        .description("Where you are in the block.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
