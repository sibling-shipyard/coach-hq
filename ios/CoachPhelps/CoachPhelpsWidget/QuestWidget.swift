import WidgetKit
import SwiftUI

struct QuestEntry: TimelineEntry {
    let date: Date
    let sizes: QuestSizes?
    let isPlaceholder: Bool
}

struct QuestProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuestEntry {
        let s = QuestSnapshotS(name: "—", completed: 0, target: 1, progressPercent: 0)
        let m = QuestSnapshot(name: "—", completed: 0, target: 1, loaded: 0, daysLeft: 0, sideQuests: [], streakLabel: nil)
        return QuestEntry(date: Date(), sizes: QuestSizes(S: s, M: m), isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (QuestEntry) -> Void) {
        completion(QuestEntry(date: Date(), sizes: AppGroupSnapshotBridge.read()?.sizes.quest, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuestEntry>) -> Void) {
        let entry = QuestEntry(date: Date(), sizes: AppGroupSnapshotBridge.read()?.sizes.quest, isPlaceholder: false)
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct QuestWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: QuestEntry

    var body: some View {
        Group {
            if let sizes = entry.sizes {
                switch family {
                case .systemMedium:
                    mediumContent(sizes.M)
                default:
                    smallContent(sizes.S)
                }
            } else {
                EmptyGlanceView(label: "MAIN QUEST", message: "Nothing logged yet")
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.paper }
    }

    // MARK: - S — title + fraction + bar only

    private func smallContent(_ quest: QuestSnapshotS) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            MonoLabel("MAIN QUEST")

            Text(quest.name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
                .lineLimit(2)

            Spacer(minLength: 0)

            fraction(completed: quest.completed, target: quest.target)
            HairlineProgress(fraction: quest.progressPercent / 100, height: 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - M — adds up to 2 side quests, per the in-app card

    private func mediumContent(_ quest: QuestSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            MonoLabel("MAIN QUEST")

            HStack(alignment: .firstTextBaseline) {
                Text(quest.name)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                    .lineLimit(1)
                Spacer()
                fraction(completed: quest.completed, target: quest.target)
            }

            HairlineProgress(fraction: quest.target > 0 ? quest.completed / quest.target : 0, height: 4)

            if !quest.sideQuests.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(quest.sideQuests.prefix(2), id: \.name) { side in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(side.name)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(WarmInstrument.ink)
                                    .lineLimit(1)
                                Spacer()
                                Text("\(Int(side.value))/\(Int(side.target))")
                                    .font(WarmInstrument.figures(10))
                                    .foregroundColor(WarmInstrument.inkMuted)
                            }
                            HairlineProgress(
                                fraction: side.target > 0 ? side.value / side.target : 0,
                                tint: WarmInstrument.color(hex: side.color),
                                height: 3
                            )
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func fraction(completed: Double, target: Double) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text("\(Int(completed))")
                .font(WarmInstrument.figures(16, weight: .bold))
            Text(" / \(Int(target))")
                .font(WarmInstrument.figures(11, weight: .semibold))
                .foregroundColor(WarmInstrument.inkFaint)
        }
        .foregroundColor(WarmInstrument.ink)
    }
}

struct QuestWidget: Widget {
    let kind = "com.coachphelps.ios.widget.quest"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: QuestProvider()) { entry in
            QuestWidgetView(entry: entry)
        }
        .configurationDisplayName("Main Quest")
        .description("This block's single priority, at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
