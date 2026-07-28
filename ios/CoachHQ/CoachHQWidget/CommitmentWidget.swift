import WidgetKit
import SwiftUI

struct CommitmentEntry: TimelineEntry {
    let date: Date
    let sizes: CommitmentSizes?
    let isPlaceholder: Bool
}

struct CommitmentProvider: TimelineProvider {
    private static var previewSizes: CommitmentSizes { GoldenDataset.snapshots.sizes.commitments }

    func placeholder(in context: Context) -> CommitmentEntry {
        CommitmentEntry(date: Date(), sizes: Self.previewSizes, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (CommitmentEntry) -> Void) {
        if context.isPreview {
            completion(CommitmentEntry(date: Date(), sizes: Self.previewSizes, isPlaceholder: false))
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
    let kind = "com.siblingshipyard.coachhq.widget.commitment"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CommitmentProvider()) { entry in
            CommitmentWidgetView(entry: entry)
        }
        .configurationDisplayName("Sport Commitment")
        .description("Kept promises, at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
