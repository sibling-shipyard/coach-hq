import WidgetKit
import SwiftUI

struct CommitmentEntry: TimelineEntry {
    let date: Date
    let sizes: CommitmentSizes?
    let isPlaceholder: Bool
}

struct CommitmentProvider: TimelineProvider {
    /// See `EngineProvider.sampleSizes` — same reasoning. The "1/2" denominator and note text
    /// mirror the Design Philosophy's own worked cube example.
    private static var sampleSizes: CommitmentSizes {
        let badminton = CommitmentSnapshot(
            id: "badminton", label: "Badminton", glyph: .badminton, value: 1, target: 2, note: "2 to go this week",
            status: "ON TRACK", progress: 50, accent: "#315a4a", alarm: false, allRecord: nil,
            rankedRecord: nil, hasRankedRecord: nil, latest: nil, latestRanked: nil, streak: 2
        )
        let calisthenics = CommitmentSnapshot(
            id: "calisthenics", label: "Calisthenics", glyph: .calisthenics, value: 0, target: 2, note: "The bar is cold.",
            status: "BEHIND", progress: 0, accent: "#4f587a", alarm: true, allRecord: nil,
            rankedRecord: nil, hasRankedRecord: nil, latest: nil, latestRanked: nil, streak: 0
        )
        let foundation = CommitmentSnapshot(
            id: "foundation", label: "Foundation", glyph: .foundation, value: 2, target: 2, note: "Floor kept",
            status: "DONE", progress: 100, accent: "#6d7d4e", alarm: false, allRecord: nil,
            rankedRecord: nil, hasRankedRecord: nil, latest: nil, latestRanked: nil, streak: 3
        )
        let cycling = CommitmentSnapshot(
            id: "cycling", label: "Ride", glyph: .cycling, value: 1, target: 1, note: "Floor kept",
            status: "DONE", progress: 100, accent: "#a8702c", alarm: false, allRecord: nil,
            rankedRecord: nil, hasRankedRecord: nil, latest: nil, latestRanked: nil, streak: 1
        )
        return CommitmentSizes(S: badminton, M: [badminton, calisthenics, foundation, cycling])
    }

    func placeholder(in context: Context) -> CommitmentEntry {
        CommitmentEntry(date: Date(), sizes: Self.sampleSizes, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (CommitmentEntry) -> Void) {
        if context.isPreview {
            completion(CommitmentEntry(date: Date(), sizes: Self.sampleSizes, isPlaceholder: false))
            return
        }
        completion(CommitmentEntry(date: Date(), sizes: AppGroupSnapshotBridge.read()?.sizes.commitments, isPlaceholder: false))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CommitmentEntry>) -> Void) {
        let entry = CommitmentEntry(date: Date(), sizes: AppGroupSnapshotBridge.read()?.sizes.commitments, isPlaceholder: false)
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 6, to: Date()) ?? Date().addingTimeInterval(6 * 3600)
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct CommitmentWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: CommitmentEntry

    private let columns = [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)]

    var body: some View {
        Group {
            if let sizes = entry.sizes {
                switch family {
                case .systemMedium:
                    mediumContent(sizes.M)
                default:
                    // Reuse the atom exactly as built for in-app Home — "never redesign it
                    // per platform," per the Design Philosophy's cube note.
                    SportCube(commitment: sizes.S)
                }
            } else {
                EmptyGlanceView(label: "COMMITMENT", message: "No commitments configured")
                    .padding(4)
            }
        }
        .redacted(reason: entry.isPlaceholder ? .placeholder : [])
        .containerBackground(for: .widget) { WarmInstrument.paper }
    }

    /// M = quartet strip — same cube atom, laid out 2×2, per "iOS home S = single sport;
    /// M = quartet strip."
    private func mediumContent(_ commitments: [CommitmentSnapshot]) -> some View {
        Group {
            if commitments.isEmpty {
                EmptyGlanceView(label: "COMMITMENTS", message: "No commitments configured")
                    .padding(4)
            } else {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(commitments.prefix(4)) { commitment in
                        SportCube(commitment: commitment)
                    }
                }
            }
        }
    }
}

struct CommitmentWidget: Widget {
    let kind = "com.coachphelps.ios.widget.commitment"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CommitmentProvider()) { entry in
            CommitmentWidgetView(entry: entry)
        }
        .configurationDisplayName("Sport Commitment")
        .description("Kept promises, at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
