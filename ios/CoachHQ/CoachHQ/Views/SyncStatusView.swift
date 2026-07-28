import SwiftUI

/// Sync home screen — black brand header, card-based status layout showing
/// last sync time, repo connection, and a manual sync button.
struct SyncStatusView: View {
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var authManager: GitHubAuthManager
    @ObservedObject var testMode = TestModeManager.shared
    @State private var toast: Toast?
    @State private var cachedEntries: [SyncCacheEntry] = []

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                BrandHeader(title: "Coach HQ")

                ScrollView {
                    VStack(spacing: 8) {
                        if testMode.isEnabled {
                            testModeBanner
                        }

                        WeeklyVolumeChart(entries: cachedEntries)
                        statusCard
                        connectionCard

                        Button(action: {
                            Haptics.tap()
                            Task { await syncManager.syncNewWorkouts() }
                        }) {
                            HStack(spacing: 8) {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 12, weight: .bold))
                                Text(syncManager.isSyncing ? "Syncing…" : "Sync Now")
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(syncManager.isSyncing)
                        .opacity(syncManager.isSyncing ? 0.5 : 1)

                        if let state = syncManager.syncState {
                            debugCard(state: state)
                        }
                    }
                    .padding(10)
                }
                .refreshable {
                    // Detached so SwiftUI's refresh-task cancellation can't kill
                    // the sync mid-flight (spurious "cancelled" errors).
                    let syncTask = Task { await syncManager.syncNewWorkouts() }
                    _ = await syncTask.result
                }
            }
            .background(Color(uiColor: .systemBackground))
            .toast($toast)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { cachedEntries = SyncCache.load() }
            .onChange(of: syncManager.lastSyncDate) { cachedEntries = SyncCache.load() }
            // Toast + haptics on every completed sync round.
            .onChange(of: syncManager.lastSyncResult) { _, result in
                guard let result else { return }
                switch result.outcome {
                case .synced(let n):
                    Haptics.success()
                    toast = Toast(kind: .success, message: "Synced \(n) new activit\(n == 1 ? "y" : "ies")")
                case .nothingNew:
                    Haptics.tap()
                    toast = Toast(kind: .info, message: "Up to date — nothing new")
                case .failed(let message):
                    Haptics.error()
                    toast = Toast(kind: .error, message: message)
                }
            }
        }
    }

    // MARK: - Test mode banner

    private var testModeBanner: some View {
        HStack(spacing: 6) {
            Image(systemName: "hammer.fill")
                .font(.system(size: 11))
            Text("Test mode — syncing to test/sync")
                .font(.system(size: 12, weight: .semibold))
        }
        .foregroundColor(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Theme.attentionOrange)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
    }

    // MARK: - Status card

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                SectionHeader("Sync Status")
                Spacer()
                statusPill
            }
            .padding(.bottom, 12)

            HStack(spacing: 12) {
                Image(systemName: syncManager.isSyncing ? "arrow.triangle.2.circlepath" : "checkmark.circle.fill")
                    .font(.system(size: 30))
                    .foregroundColor(syncManager.isSyncing ? Theme.attentionOrange : Theme.accentGreen)
                    .rotationEffect(syncManager.isSyncing ? .degrees(360) : .zero)
                    .animation(
                        syncManager.isSyncing
                            ? .linear(duration: 1).repeatForever(autoreverses: false)
                            : .default,
                        value: syncManager.isSyncing
                    )

                VStack(alignment: .leading, spacing: 2) {
                    Text(syncManager.isSyncing ? "Syncing..." : "Up to date")
                        .font(.system(size: 17, weight: .semibold))

                    if let lastSync = syncManager.lastSyncDate {
                        Text("Last synced \(lastSync.formatted(.relative(presentation: .named)))")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    } else if let ts = syncManager.syncState?.hkLastSynced,
                              let date = ISO8601DateFormatter().date(from: ts) {
                        Text("Last synced \(date.formatted(.relative(presentation: .named)))")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    } else {
                        Text("Not synced yet")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    }
                }
            }

            if let error = syncManager.syncError {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(.top, 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                .stroke(Theme.cardBorder, lineWidth: 1)
        )
    }

    private var statusPill: some View {
        Text(syncManager.isSyncing ? "ACTIVE" : "IDLE")
            .font(.system(size: 9, weight: .bold))
            .kerning(1)
            .foregroundColor(syncManager.isSyncing ? Theme.attentionOrange : Theme.accentGreen)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background((syncManager.isSyncing ? Theme.attentionOrange : Theme.accentGreen).opacity(0.12))
            .clipShape(Capsule())
    }

    // MARK: - Connection card

    private var connectionCard: some View {
        ThemedCard {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Connection")

                InfoRow(icon: "bolt.fill", text: "Auto-syncs when workouts complete")
                InfoRow(icon: "externaldrive.connected.to.line.below", text: "Commits directly to your GitHub repo")
                if let repo = authManager.selectedRepo {
                    InfoRow(icon: "folder.fill", text: repo, mono: true)
                }
                InfoRow(
                    icon: "arrow.triangle.branch",
                    text: testMode.targetBranch,
                    mono: true,
                    tint: testMode.isEnabled ? Theme.attentionOrange : nil
                )
            }
        }
    }

    // MARK: - Debug card

    private func debugCard(state: SyncState) -> some View {
        ThemedCard {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader("Debug")

                if let ts = state.hkLastSynced, let date = ISO8601DateFormatter().date(from: ts) {
                    InfoRow(icon: "clock", text: "hk_last_synced: \(date.formatted(.relative(presentation: .named)))", mono: true)
                } else {
                    InfoRow(icon: "clock", text: "hk_last_synced: never", mono: true)
                }

                // Per-type counts from the most recent sync round.
                if syncManager.lastSyncDate != nil {
                    if syncManager.lastRoundSynced.isEmpty {
                        InfoRow(icon: "tray", text: "last round: nothing new", mono: true)
                    } else {
                        InfoRow(icon: "tray.full", text: "last round:", mono: true)
                        ForEach(syncManager.lastRoundSynced.sorted(by: { $0.key < $1.key }), id: \.key) { key, val in
                            HStack {
                                Text(key)
                                    .font(.system(size: 12, design: .monospaced))
                                    .foregroundColor(.secondary)
                            Spacer()
                            Text("\(val)")
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .foregroundColor(Theme.accentGreen)
                                .contentTransition(.numericText())
                            }
                        }
                        Divider()
                    }
                }

                if let counters = state.counters, !counters.isEmpty {
                    Text("totals")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundColor(.secondary)
                    ForEach(counters.sorted(by: { $0.key < $1.key }), id: \.key) { key, val in
                        HStack {
                            Text(key)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundColor(.secondary)
                            Spacer()
                            Text("\(val)")
                                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                .contentTransition(.numericText())
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Weekly Volume Chart

/// Vertical bar chart: last 7 days (Mon–Sun), height ∝ total workout duration,
/// colored by dominant sport. Built from the local cache — no network calls.
private struct WeeklyVolumeChart: View {
    let entries: [SyncCacheEntry]

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current; return f
    }()
    private static let inputFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"; f.timeZone = .current; return f
    }()

    private struct DayBar: Identifiable {
        let id: String
        let label: String
        let duration: Int
        let color: Color
        let isToday: Bool
        let isFuture: Bool
    }

    private var bars: [DayBar] {
        let cal = Calendar.current
        let today = Date()
        let daysSinceMonday = (cal.component(.weekday, from: today) + 5) % 7
        guard let monday = cal.date(byAdding: .day, value: -daysSinceMonday, to: cal.startOfDay(for: today)) else { return [] }
        let dayLabels = ["M", "T", "W", "T", "F", "S", "S"]
        return (0..<7).compactMap { i -> DayBar? in
            guard let date = cal.date(byAdding: .day, value: i, to: monday) else { return nil }
            let dateStr = Self.dayFormatter.string(from: date)
            let dayEntries = entries.filter {
                guard let d = Self.inputFormatter.date(from: $0.startDateLocal) else { return false }
                return Self.dayFormatter.string(from: d) == dateStr
            }
            return DayBar(
                id: dateStr,
                label: dayLabels[i],
                duration: dayEntries.reduce(0) { $0 + $1.elapsedTime },
                color: Theme.sportBadge(for: dayEntries.first?.sportType ?? "").color,
                isToday: cal.isDateInToday(date),
                isFuture: date > today
            )
        }
    }

    var body: some View {
        ThemedCard {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader("This Week")

                let maxDuration = max(1, bars.map(\.duration).max() ?? 1)
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(bars) { bar in
                        VStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(bar.isFuture || bar.duration == 0
                                      ? Theme.mutedBackground
                                      : bar.color)
                                .frame(height: max(3, 48 * CGFloat(bar.duration) / CGFloat(maxDuration)))
                            Text(bar.label)
                                .font(.system(size: 9, weight: bar.isToday ? .bold : .regular))
                                .foregroundColor(bar.isToday ? .primary : .secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .animation(.spring(duration: 0.5, bounce: 0.1), value: bar.duration)
                    }
                }
                .frame(height: 62, alignment: .bottom)
            }
        }
    }
}

/// Icon + text row used in the connection and debug cards.
private struct InfoRow: View {
    let icon: String
    let text: String
    var mono: Bool = false
    var tint: Color? = nil

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundColor(tint ?? Theme.accentGreen)
                .frame(width: 18)
            Text(text)
                .font(mono ? .system(size: 12, design: .monospaced) : .system(size: 13))
                .foregroundColor(tint ?? .primary)
        }
    }
}
