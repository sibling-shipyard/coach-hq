import SwiftUI

struct ActivityListView: View {
    /// When pushed from Home, skip the outer `NavigationStack` — the parent stack owns back navigation.
    var embedded: Bool = false
    /// When set (embedded Home), row taps call this instead of local `NavigationStack` push.
    var onSelectEntry: ((SyncCacheEntry) -> Void)? = nil

    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var authManager: GitHubAuthManager
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [SyncCacheEntry] = []
    @State private var toast: Toast?
    @State private var navigationPath: [SyncCacheEntry] = []
    @State private var didInitialLoad = false

    /// Re-run GitHub backfill once repo discovery finishes (same pattern as Home / Workouts).
    private var activityFetchToken: String {
        [
            authManager.isSessionReady ? "ready" : "boot",
            authManager.repoFullName ?? "",
        ].joined(separator: "|")
    }

    private static let inputFmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.timeZone = .current
        return f
    }()

    private var recentEntries: [SyncCacheEntry] {
        let cutoff = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? .distantPast
        return entries
            .filter { e in
                guard let d = Self.inputFmt.date(from: e.startDateLocal) else { return false }
                return d >= cutoff
            }
            .sorted { $0.startDateLocal > $1.startDateLocal }
    }

    private var grouped: [DayGroup] { groupByDay(recentEntries) }

    var body: some View {
        Group {
            if embedded || onSelectEntry != nil {
                content
            } else {
                NavigationStack(path: $navigationPath) {
                    content
                        .navigationDestination(for: SyncCacheEntry.self) { entry in
                            ActivityDetailView(entry: entry)
                        }
                }
            }
        }
    }

    private var content: some View {
        contentStack
            .edgeBackSwipe(enabled: embedded) { dismiss() }
    }

    private var contentStack: some View {
        VStack(spacing: 0) {
            warmHeader

            ScrollView {
                if recentEntries.isEmpty {
                    emptyState
                        .padding(.horizontal, 16)
                        .padding(.top, 24)
                } else {
                    ActivityFeedView(
                        entries: recentEntries,
                        grouped: grouped,
                        onSelect: selectEntry,
                        animateEntrance: !embedded
                    )
                }
            }
            .scrollClipDisabled()
            .refreshable { await pullToSync() }
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
        .toast($toast)
        .toolbar(.hidden, for: .navigationBar)
        .hidesMainTabBar(embedded)
        .task(id: activityFetchToken) {
            entries = SyncCache.load()
            guard authManager.isSessionReady else { return }
            guard authManager.repoFullName != nil else { return }
            guard !didInitialLoad else { return }
            didInitialLoad = true
            await syncManager.backfillRecentCache()
            entries = SyncCache.load()
            await backfillStats()
        }
        .onChange(of: syncManager.lastSyncDate) {
            withAnimation(PremiumMotion.state) {
                entries = SyncCache.load()
            }
            Task { await backfillStats() }
        }
        .onChange(of: syncManager.lastSyncResult) { _, result in
            guard let result else { return }
            switch result.outcome {
            case .synced(let n):
                Haptics.success()
                toast = Toast(kind: .success, message: "Synced \(n) new activit\(n == 1 ? "y" : "ies")")
            case .nothingNew:
                Haptics.tap()
                toast = Toast(kind: .info, message: "Up to date")
            case .failed(let msg):
                authManager.noteAPIError(msg)
                Haptics.error()
                toast = Toast(kind: .error, message: msg)
            }
        }
    }

    private var warmHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                if embedded {
                    Button {
                        Haptics.tap()
                        dismiss()
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(WarmInstrument.inkMuted)
                    }
                    .buttonStyle(.plain)

                    Text("HQ")
                        .font(WarmInstrument.monoLabel(12))
                        .tracking(1.4)
                        .foregroundColor(WarmInstrument.ink)
                } else {
                    MonoLabel("Activities", size: 12, color: WarmInstrument.ink, tracking: 1.4)
                }
            }

            Text("The ledger")
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(Theme.ink)

            MonoLabel("LAST 7 DAYS", size: 10, tracking: 1.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
    }

    // MARK: - Navigation

    private func selectEntry(_ entry: SyncCacheEntry) {
        Haptics.tap()
        if let onSelectEntry {
            onSelectEntry(entry)
        } else {
            navigationPath.append(entry)
        }
    }

    // MARK: - Helpers

    private func pullToSync() async {
        let t = Task { await syncManager.syncNewWorkouts() }
        _ = await t.result
    }

    private func backfillStats() async {
        let stale = recentEntries.filter { $0.needsStatsBackfill || $0.needsActivityBackfill }
        guard !stale.isEmpty else { return }
        let api = GitHubAPIClient(authManager: authManager)
        for entry in stale {
            guard let activity = try? await api.readActivity(fileName: entry.fileName) else { continue }
            SyncCache.updateStats(fileName: entry.fileName, activity: activity)
        }
        withAnimation(PremiumMotion.state) {
            entries = SyncCache.load()
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 10) {
                CardKicker(label: "LAST 7 DAYS", trailing: "0 SESSIONS")
                Text("No sessions logged yet — nothing invented here.")
                    .font(WarmInstrument.coachVoice(14))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Pull down to sync from HealthKit.")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(WarmInstrument.inkFaint)
            }
        }
    }
}
