import SwiftUI

struct ActivityListView: View {
    /// When pushed from Home, skip the outer `NavigationStack` — the parent stack owns back navigation.
    var embedded: Bool = false

    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var authManager: GitHubAuthManager
    @Environment(\.dismiss) private var dismiss
    @State private var entries: [SyncCacheEntry] = []
    @State private var toast: Toast?
    @AppStorage("feedVariant") private var feedVariant = 0

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
            if embedded {
                content
            } else {
                NavigationStack {
                    content
                        .navigationDestination(for: SyncCacheEntry.self) { entry in
                            ActivityDetailView(entry: entry)
                        }
                }
            }
        }
    }

    private var content: some View {
        VStack(spacing: 0) {
            warmHeader

            if recentEntries.isEmpty {
                ScrollView {
                    emptyState.frame(maxWidth: .infinity).padding(.top, 100)
                }
                .scrollClipDisabled()
                .refreshable { await pullToSync() }
            } else {
                ScrollView {
                    switch feedVariant {
                    case 1:
                        FeedVariant2(entries: recentEntries, grouped: grouped)
                    case 2:
                        FeedVariant3(entries: recentEntries)
                    default:
                        FeedVariant1(entries: recentEntries, grouped: grouped)
                    }
                }
                .scrollClipDisabled()
                .refreshable { await pullToSync() }
            }
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
        .toast($toast)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            entries = SyncCache.load()
            await syncManager.backfillRecentCache()
            entries = SyncCache.load()
            await backfillStats()
        }
        .onChange(of: syncManager.lastSyncDate) {
            withAnimation(.spring(duration: 0.4, bounce: 0.15)) {
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
                Haptics.error()
                toast = Toast(kind: .error, message: msg)
            }
        }
        .onAppear { entries = SyncCache.load() }
    }

    private var warmHeader: some View {
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
            }

            Text("Activities")
                .font(.system(size: embedded ? 17 : 26, weight: .bold))
                .foregroundColor(Theme.ink)

            Spacer(minLength: 8)

            variantPicker
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(WarmInstrument.paper)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(WarmInstrument.headerRule)
                .frame(height: 1)
        }
    }

    // MARK: - Variant picker (1 / 2 / 3 dots in the header)

    private var variantPicker: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { i in
                Button {
                    Haptics.tap()
                    withAnimation(.spring(duration: 0.25, bounce: 0.15)) { feedVariant = i }
                } label: {
                    Text("\(i + 1)")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(feedVariant == i ? WarmInstrument.paper : WarmInstrument.inkFaint)
                        .frame(width: 20, height: 20)
                        .background(feedVariant == i ? WarmInstrument.ink : Color.clear)
                        .clipShape(Circle())
                        .animation(.spring(duration: 0.2), value: feedVariant)
                }
            }
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 3)
        .background(WarmInstrument.surfaceMuted)
        .clipShape(Capsule())
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
        entries = SyncCache.load()
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "figure.badminton")
                .font(.system(size: 40))
                .foregroundColor(WarmInstrument.sportColor(.badminton))
            Text("No activities yet")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(Theme.ink)
            Text("Pull down to sync from HealthKit.")
                .font(.footnote)
                .foregroundColor(WarmInstrument.inkMuted)
        }
    }
}
