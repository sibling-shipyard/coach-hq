import SwiftUI

/// Full training history, paginated — the "All activity" destination from Home.
///
/// Deliberately does not reuse the `recentEntries`/`SyncCache` path other feed views take:
/// that cache only ever backfills the last 7 days and actively evicts anything older than
/// 30 (see `SyncCache.evictionDays`), so it can never back a genuine "everything" list.
/// Listing and fetched bodies live on `AllActivitiesStore` (app-lifetime, keyed by repo)
/// so popping this view does not throw the GitHub work away. Lazy "Load 20 more" still
/// pages bodies; nothing here is written into `SyncCache`.
struct AllActivitiesListView: View {
    /// Row taps call this instead of owning navigation — the same embedded pattern other
    /// feed views use, so this pushes onto the *caller's* NavigationStack (Home's)
    /// rather than nesting a second one.
    var onSelectEntry: (SyncCacheEntry) -> Void

    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var allActivitiesStore: AllActivitiesStore
    @Environment(\.dismiss) private var dismiss

    private var activityFetchToken: String {
        [
            authManager.isSessionReady ? "ready" : "boot",
            authManager.repoFullName ?? "",
        ].joined(separator: "|")
    }

    private var histClient: GitHubActivityHistClient {
        GitHubActivityHistClient(authManager: authManager)
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                if allActivitiesStore.isLoadingInitial && allActivitiesStore.loadedEntries.isEmpty {
                    fallbackHeader
                    loadingState
                        .padding(.horizontal, 16)
                        .padding(.top, 24)
                } else if let loadError = allActivitiesStore.loadError,
                          allActivitiesStore.loadedEntries.isEmpty {
                    fallbackHeader
                    errorState(loadError)
                        .padding(.horizontal, 16)
                        .padding(.top, 24)
                } else if allActivitiesStore.loadedEntries.isEmpty {
                    fallbackHeader
                    emptyState
                        .padding(.horizontal, 16)
                        .padding(.top, 24)
                } else {
                    ActivityLedgerView(
                        entries: allActivitiesStore.loadedEntries,
                        onSelect: onSelectEntry,
                        onBack: { dismiss() },
                        footer: { loadMoreFooter }
                    )
                    // Keep ledger @State across load-more footer/spinner swaps.
                    .id("activity-ledger")
                }
            }
            .scrollClipDisabled()
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .hidesMainTabBar(true)
        .edgeBackSwipe(enabled: true) { dismiss() }
        .task(id: activityFetchToken) {
            guard authManager.isSessionReady, let repo = authManager.repoFullName else { return }
            await allActivitiesStore.loadInitialIfNeeded(repo: repo, client: histClient)
        }
    }

    private var fallbackHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                Haptics.tap()
                dismiss()
            } label: {
                Text("‹ HQ")
                    .font(WarmInstrument.monoLabel(10, weight: .bold))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.inkMuted)
            }
            .buttonStyle(.plain)

            Text("Activity Ledger")
                .font(.system(size: 30, weight: .semibold))
                .tracking(-0.9)
                .foregroundColor(WarmInstrument.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 22)
        .padding(.top, 12)
    }

    // MARK: - Load more

    @ViewBuilder
    private var loadMoreFooter: some View {
        if allActivitiesStore.hasMore {
            Button {
                Haptics.tap()
                Task { await allActivitiesStore.loadMore(client: histClient) }
            } label: {
                HStack(spacing: 8) {
                    if allActivitiesStore.isLoadingMore {
                        WarmSignalLoader(size: 18)
                    }
                    Text(allActivitiesStore.isLoadingMore ? "Loading…" : "Load 20 more")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(WarmInstrument.ink)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)
            .disabled(allActivitiesStore.isLoadingMore)
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
        WarmPageWait()
            .frame(minHeight: 220)
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
                        guard let repo = authManager.repoFullName else { return }
                        await allActivitiesStore.retry(repo: repo, client: histClient)
                    }
                }
                .font(.system(size: 13, weight: .semibold))
            }
        }
    }
}
