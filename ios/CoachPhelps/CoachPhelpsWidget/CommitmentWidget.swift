import WidgetKit
import SwiftUI

struct CommitmentEntry: TimelineEntry {
    let date: Date
    let commitment: CommitmentSnapshot?
    let isPlaceholder: Bool
}

struct CommitmentProvider: TimelineProvider {
    private static let placeholderCommitment = CommitmentSnapshot(
        id: "placeholder", label: "—", glyph: .other, value: 0, target: nil, note: "",
        status: "", progress: 0, accent: "#98998f", alarm: false, allRecord: nil,
        rankedRecord: nil, hasRankedRecord: nil, latest: nil, latestRanked: nil, streak: nil
    )

    func placeholder(in context: Context) -> CommitmentEntry {
        CommitmentEntry(date: Date(), commitment: Self.placeholderCommitment, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (CommitmentEntry) -> Void) {
        completion(CommitmentEntry(date: Date(), commitment: AppGroupSnapshotBridge.read()?.sizes.commitments.S, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CommitmentEntry>) -> Void) {
        let entry = CommitmentEntry(date: Date(), commitment: AppGroupSnapshotBridge.read()?.sizes.commitments.S, isPlaceholder: false)
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct CommitmentWidgetView: View {
    let entry: CommitmentEntry

    var body: some View {
        Group {
            if let commitment = entry.commitment {
                // Reuse the atom exactly as built for in-app Home — "never redesign it per
                // platform," per the Design Philosophy's cube note. SportCube already carries
                // its own padding, background, and border, so it drops into the widget as-is.
                SportCube(commitment: commitment)
            } else {
                EmptyGlanceView(label: "COMMITMENT", message: "No commitments configured")
                    .padding(4)
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.paper }
    }
}

struct CommitmentWidget: Widget {
    let kind = "com.coachphelps.ios.widget.commitment"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CommitmentProvider()) { entry in
            CommitmentWidgetView(entry: entry)
        }
        .configurationDisplayName("Sport Commitment")
        .description("One kept promise, at a glance.")
        .supportedFamilies([.systemSmall])
    }
}
