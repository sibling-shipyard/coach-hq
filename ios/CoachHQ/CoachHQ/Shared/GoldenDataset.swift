import Foundation

/// Sample-only data for SwiftUI previews and product screenshots. Decodes
/// `Resources/golden_widget_snapshots.json` — synced from
/// `shared/golden-dataset/widget_snapshots.json` by `ios/scripts/sync-golden-dataset.mjs`
/// (Xcode pre-build phase; see `shared/golden-dataset/README.md` and ADR 0005 / ADR 0007).
/// Uses the unmodified `WidgetSnapshotsFile` model, same as `AppGroupSnapshotBridge` — if this
/// fails to decode, the web schema and the bundled copy have drifted; run the sync script
/// rather than patching the models. Never shown to a signed-in athlete as if it were their own data.
enum GoldenDataset {
    static let snapshots: WidgetSnapshotsFile = {
        guard
            let url = Bundle.main.url(forResource: "golden_widget_snapshots", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let file = try? JSONDecoder().decode(WidgetSnapshotsFile.self, from: data)
        else {
            preconditionFailure("golden_widget_snapshots.json is missing or out of sync with WidgetSnapshotsFile")
        }
        return file
    }()

    static var home: WarmHomeSnapshots { snapshots.home }
    static var engine: EngineSnapshot { home.engine }
    static var quest: QuestSnapshot { home.quest }
    static var commitments: [CommitmentSnapshot] { home.commitments }
    static var sessions: [RecentSessionSnapshot] { home.sessions }
    static var phase: BuildPhaseSnapshot { home.phase }
    static var sync: WidgetSyncSnapshot { home.sync }
}
