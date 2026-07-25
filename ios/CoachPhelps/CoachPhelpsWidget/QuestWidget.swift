import WidgetKit
import SwiftUI

struct QuestEntry: TimelineEntry {
    let date: Date
    let quest: QuestSnapshotS?
    let isPlaceholder: Bool
}

struct QuestProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuestEntry {
        QuestEntry(
            date: Date(),
            quest: QuestSnapshotS(name: "—", completed: 0, target: 1, progressPercent: 0),
            isPlaceholder: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (QuestEntry) -> Void) {
        completion(QuestEntry(date: Date(), quest: AppGroupSnapshotBridge.read()?.sizes.quest.S, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuestEntry>) -> Void) {
        let entry = QuestEntry(date: Date(), quest: AppGroupSnapshotBridge.read()?.sizes.quest.S, isPlaceholder: false)
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct QuestWidgetView: View {
    let entry: QuestEntry

    var body: some View {
        Group {
            if let quest = entry.quest {
                content(quest)
            } else {
                EmptyGlanceView(label: "MAIN QUEST", message: "Nothing logged yet")
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.paper }
    }

    private func content(_ quest: QuestSnapshotS) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            MonoLabel("MAIN QUEST")

            Text(quest.name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
                .lineLimit(2)

            Spacer(minLength: 0)

            HStack(alignment: .firstTextBaseline, spacing: 1) {
                Text("\(Int(quest.completed))")
                    .font(WarmInstrument.figures(16, weight: .bold))
                Text(" / \(Int(quest.target))")
                    .font(WarmInstrument.figures(11, weight: .semibold))
                    .foregroundColor(WarmInstrument.inkFaint)
            }
            .foregroundColor(WarmInstrument.ink)

            HairlineProgress(fraction: quest.progressPercent / 100, height: 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
        .supportedFamilies([.systemSmall])
    }
}
