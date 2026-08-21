import SwiftUI

/// The manual escape hatch for sync: every HealthKit workout on the phone, with whether we
/// committed it, and an Import button for the ones we didn't.
///
/// Automatic sync re-scans a 14-day window (`HealthKitSyncManager.lookbackWindowDays`), which
/// covers a watch that transfers late. Anything slower than that would otherwise be invisible —
/// this screen is where the athlete sees it and fixes it.
struct HealthSettingsView: View {
    typealias Row = HealthKitSyncManager.HealthImportRow

    @EnvironmentObject var syncManager: HealthKitSyncManager
    @Environment(\.dismiss) private var dismiss

    private enum LoadState {
        case loading
        /// The reads failed. Distinct from `.loaded([])` — a screen that answers "what is
        /// synced?" must never render a failed read as "nothing is synced".
        case failed
        case loaded([Row])
    }

    @State private var loadState: LoadState = .loading
    @State private var importingID: String?
    @State private var toast: Toast?

    private static let windowDays = 90

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header

                    switch loadState {
                    case .loading:
                        loadingState
                    case .failed:
                        failedState
                    case .loaded(let rows) where rows.isEmpty:
                        emptyState
                    case .loaded(let rows):
                        list(rows)
                        footnote(rows)
                    }
                }
                .padding(20)
            }
            .background(WarmInstrument.desk.ignoresSafeArea())
            .navigationTitle("Health Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(WarmInstrument.accent)
                }
            }
            .refreshable { await load() }
            .toast($toast)
        }
        .task { await load() }
    }

    // MARK: - Pieces

    private var header: some View {
        HStack {
            MonoLabel("Sessions in the last \(Self.windowDays) days", size: 11, tracking: 1.4)
            Spacer()
            if case .loaded(let rows) = loadState {
                Text("\(rows.count)")
                    .font(WarmInstrument.figures(13, weight: .bold))
                    .foregroundColor(WarmInstrument.ink)
                    .contentTransition(.numericText())
            }
        }
    }

    private func list(_ rows: [Row]) -> some View {
        WarmCard(padding: 0) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 {
                        Rectangle()
                            .fill(WarmInstrument.headerRule)
                            .frame(height: 1)
                            .padding(.leading, 64)
                    }
                    WorkoutImportRow(
                        row: row,
                        isImporting: importingID == row.id,
                        isBusy: importingID != nil || syncManager.isSyncing,
                        onImport: { Task { await runImport(row) } }
                    )
                }
            }
        }
    }

    private var failedState: some View {
        WarmCard {
            VStack(spacing: 10) {
                Text("Couldn't check your history")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.ink)
                Text("Apple Health or GitHub didn't answer, so we can't say what's synced yet.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    Haptics.tap()
                    Task { await load() }
                } label: {
                    Text("Try again")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(WarmInstrument.paper)
                        .frame(minWidth: 120)
                        .frame(height: 38)
                        .background(WorkoutTimerWarm.rust)
                        .clipShape(Capsule())
                }
                .buttonStyle(TimerWarmPressStyle())
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
        }
    }

    private var loadingState: some View {
        WarmCard {
            HStack(spacing: 10) {
                ProgressView()
                Text("Reading Apple Health…")
                    .font(.system(size: 13))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 18)
        }
    }

    private var emptyState: some View {
        WarmCard(dashed: true) {
            VStack(spacing: 6) {
                Text("Nothing to show")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.ink)
                Text("No workouts in the last \(Self.windowDays) days, or Apple Health hasn't been connected yet.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }
    }

    @ViewBuilder
    private func footnote(_ rows: [Row]) -> some View {
        let multiSource = rows.filter { $0.sources.count > 1 }.count
        let unknowns = rows.filter { $0.state == .unknown }.count

        VStack(alignment: .leading, spacing: 6) {
            Text("One row per session. Sync picks these up automatically — Import is for anything that reached the phone too late for it.")
                .font(.system(size: 12))
                .foregroundColor(WarmInstrument.inkFaint)
                .fixedSize(horizontal: false, vertical: true)

            if multiSource > 0 {
                Text("\(multiSource) recorded by more than one app. Each is stored once, under the first source listed.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if unknowns > 0 {
                Text("\(unknowns) can't be checked — that day has history saved before workouts carried an id, so importing could duplicate it.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Actions

    private func load() async {
        if let rows = await syncManager.loadHealthImportRows(daysBack: Self.windowDays) {
            loadState = .loaded(rows)
        } else {
            loadState = .failed
        }
    }

    private func runImport(_ row: Row) async {
        Haptics.tap()
        importingID = row.id
        await syncManager.importWorkout(row)

        if let outcome = syncManager.lastSyncResult?.outcome {
            switch outcome {
            case .synced:
                Haptics.success()
                toast = Toast(kind: .success, message: "Workout imported")
            case .failed(let message):
                Haptics.error()
                toast = Toast(kind: .error, message: message)
            case .nothingNew:
                // Dedup caught it — the list was showing stale state, and reloading fixes it.
                toast = Toast(kind: .info, message: "Already synced")
            }
        }

        importingID = nil
        await load()
    }
}

// MARK: - Row

private struct WorkoutImportRow: View {
    let row: HealthKitSyncManager.HealthImportRow
    let isImporting: Bool
    let isBusy: Bool
    let onImport: () -> Void

    private var sport: (label: String, color: Color) { Theme.sportBadge(for: row.sportType) }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: Theme.sportIcon(for: row.sportType))
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(sport.color)
                .frame(width: 40, height: 40)
                .background(sport.color.opacity(0.1))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(Self.dateLabel(for: row.start))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Theme.ink)

                Text("\(Self.timeLabel(for: row.start)) · \(Self.durationLabel(for: row.duration)) · \(row.sources.joined(separator: " + "))")
                    .font(WarmInstrument.figures(11))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            trailing
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var trailing: some View {
        switch row.state {
        case .synced:
            Image(systemName: "checkmark")
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(WarmInstrument.sportColor(.foundation))
                .accessibilityLabel("Synced")

        case .unknown:
            MonoLabel("Can't check", size: 9, color: WarmInstrument.inkFaint)

        case .notSynced:
            Button(action: onImport) {
                Group {
                    if isImporting {
                        ProgressView()
                            .controlSize(.small)
                            .tint(WarmInstrument.paper)
                    } else {
                        Text("Import")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(WarmInstrument.paper)
                    }
                }
                .frame(minWidth: 64)
                .frame(height: 30)
                .background(WorkoutTimerWarm.rust)
                .clipShape(Capsule())
            }
            .buttonStyle(TimerWarmPressStyle())
            .disabled(isBusy)
            .opacity(isBusy && !isImporting ? 0.5 : 1)
        }
    }

    // MARK: - Labels

    private static func dateLabel(for date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.day().month(.abbreviated).year())
    }

    private static func timeLabel(for date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    private static func durationLabel(for duration: TimeInterval) -> String {
        let minutes = max(0, Int(duration.rounded()) / 60)
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }
}
