import SwiftUI

/// Full training history, paginated — the "All activity" destination from Home.
///
/// Deliberately does not reuse `ActivityListView`'s `recentEntries`/`SyncCache` path:
/// that cache only ever backfills the last 7 days and actively evicts anything older than
/// 30 (see `SyncCache.evictionDays`), so it can never back a genuine "everything" list.
/// Instead this fetches the full `user_data/activities/hist` file listing once (cheap,
/// one GitHub Contents API call via `GitHubAPIClient.listFiles`), keeps the sorted
/// filenames in memory, and lazily fetches activity bodies 50 at a time with a
/// "Load 20 more" control — nothing here touches `SyncCache`, so nothing here is evicted.
struct AllActivitiesListView: View {
    private static let initialPageSize = 50
    private static let loadMorePageSize = 20

    /// Row taps call this instead of owning navigation — matches `ActivityListView`'s
    /// `embedded` pattern so this pushes onto the *caller's* NavigationStack (Home's)
    /// rather than nesting a second one.
    var onSelectEntry: (SyncCacheEntry) -> Void

    @EnvironmentObject var authManager: GitHubAuthManager
    @Environment(\.dismiss) private var dismiss

    /// Every filename in `user_data/activities/hist`, sorted newest-first. Fetched once;
    /// pagination below just slices further into it without re-listing.
    @State private var allFileNames: [String] = []
    @State private var loadedEntries: [SyncCacheEntry] = []
    @State private var isLoadingInitial = false
    @State private var isLoadingMore = false
    @State private var loadError: String?
    @State private var didInitialLoad = false

    private var activityFetchToken: String {
        [
            authManager.isSessionReady ? "ready" : "boot",
            authManager.repoFullName ?? "",
        ].joined(separator: "|")
    }

    private var hasMore: Bool { loadedEntries.count < allFileNames.count }
    private var grouped: [DayGroup] { groupByDay(loadedEntries) }

    var body: some View {
        VStack(spacing: 0) {
            warmHeader

            ScrollView {
                if isLoadingInitial && loadedEntries.isEmpty {
                    loadingState
                        .padding(.horizontal, 16)
                        .padding(.top, 24)
                } else if let loadError, loadedEntries.isEmpty {
                    errorState(loadError)
                        .padding(.horizontal, 16)
                        .padding(.top, 24)
                } else if loadedEntries.isEmpty {
                    emptyState
                        .padding(.horizontal, 16)
                        .padding(.top, 24)
                } else {
                    ActivityFeedView(
                        entries: loadedEntries,
                        grouped: grouped,
                        onSelect: onSelectEntry,
                        animateEntrance: false,
                        kickerLabel: "ALL ACTIVITY",
                        showWeekSummary: false,
                        footer: AnyView(loadMoreFooter)
                    )
                }
            }
            .scrollClipDisabled()
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .hidesMainTabBar(true)
        .edgeBackSwipe(enabled: true) { dismiss() }
        .task(id: activityFetchToken) {
            guard authManager.isSessionReady, authManager.repoFullName != nil else { return }
            guard !didInitialLoad else { return }
            didInitialLoad = true
            await loadInitial()
        }
    }

    private var warmHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
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
            }

            Text("Activity ledger")
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(Theme.ink)

            Text("Every entry earns its load — nothing invented.")
                .font(WarmInstrument.coachVoice(14))
                .foregroundColor(WarmInstrument.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
    }

    // MARK: - Load more

    @ViewBuilder
    private var loadMoreFooter: some View {
        if hasMore {
            Button {
                Haptics.tap()
                Task { await loadMore() }
            } label: {
                if isLoadingMore {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                } else {
                    Text("Load 20 more")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(WarmInstrument.ink)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
            }
            .buttonStyle(.plain)
            .disabled(isLoadingMore)
        }
    }

    // MARK: - Empty / error / loading states

    private var emptyState: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 10) {
                CardKicker(label: "ALL ACTIVITY", trailing: "0 SESSIONS")
                Text("No sessions logged yet — nothing invented here.")
                    .font(WarmInstrument.coachVoice(14))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var loadingState: some View {
        WarmCard {
            HStack {
                Spacer()
                ProgressView()
                Spacer()
            }
            .padding(.vertical, 20)
        }
    }

    private func errorState(_ message: String) -> some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 10) {
                CardKicker(label: "ALL ACTIVITY", trailing: "ERROR")
                Text(message)
                    .font(WarmInstrument.coachVoice(14))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Retry") {
                    Task {
                        didInitialLoad = false
                        loadError = nil
                        await loadInitial()
                    }
                }
                .font(.system(size: 13, weight: .semibold))
            }
        }
    }

    // MARK: - Fetching

    private func loadInitial() async {
        isLoadingInitial = true
        defer { isLoadingInitial = false }
        let api = GitHubAPIClient(authManager: authManager)
        do {
            let files = try await api.listFiles(path: "user_data/activities/hist")
            // Filenames encode the activity date (e.g. "hk_2026-08-03_<uuid>.json") so a
            // plain lexical sort gives newest-first without parsing every entry.
            allFileNames = files
                .filter { $0.type == "file" }
                .map(\.name)
                .sorted(by: >)
            loadError = nil
            await fetchPage(api: api, count: Self.initialPageSize)
        } catch {
            loadError = "Couldn't load activity history"
        }
    }

    private func loadMore() async {
        guard !isLoadingMore, hasMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let api = GitHubAPIClient(authManager: authManager)
        await fetchPage(api: api, count: Self.loadMorePageSize)
    }

    private func fetchPage(api: GitHubAPIClient, count: Int) async {
        let start = loadedEntries.count
        guard start < allFileNames.count else { return }
        let end = min(start + count, allFileNames.count)
        var newEntries: [SyncCacheEntry] = []
        for fileName in allFileNames[start..<end] {
            guard let activity = try? await api.readActivity(fileName: fileName) else { continue }
            newEntries.append(SyncCacheEntry(
                fileName: fileName,
                activity: activity,
                hasDescription: !(activity.description ?? "").isEmpty
            ))
        }
        loadedEntries.append(contentsOf: newEntries)
    }
}
