import SwiftUI

/// Shows a synced activity's stats and lets the user paste raw match scores,
/// previewing the parsed/formatted result live, then commits both the activity
/// file and `ebadders_history.json` to GitHub in one atomic commit.
///
/// Card-based layout matching the website: stats card at top, description input
/// below with a live preview card.
struct ActivityDetailView: View {
    let entry: SyncCacheEntry

    @EnvironmentObject var authManager: GitHubAuthManager

    @State private var activity: Activity?
    @State private var descriptionText: String = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var saveSucceeded = false
    @State private var isEditing = false
    @FocusState private var editorFocused: Bool

    /// The saved description on the server (nil/empty until scored).
    private var savedDescription: String? {
        guard let desc = activity?.description, !desc.isEmpty else { return nil }
        return desc
    }

    private var apiClient: GitHubAPIClient {
        // targetBranch is a computed property governed by TestModeManager —
        // don't override it here. Previously this forced "main" unconditionally,
        // which would have silently bypassed test mode for this exact save flow.
        GitHubAPIClient(authManager: authManager)
    }

    private var badge: (label: String, color: Color) {
        Theme.sportBadge(for: entry.sportType)
    }

    private var parsed: ParsedDescription? {
        DescriptionParser.parseRawDescription(descriptionText)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                statsCard
                zoneBreakdownSection

                Group {
                    if isEditing {
                        editorCard
                        previewCard
                    } else {
                        descriptionDisplayCard
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                }

                if isEditing {
                    Button(action: { Task { await saveAndSync() } }) {
                        HStack(spacing: 8) {
                            if isSaving {
                                ProgressView()
                                    .tint(.white)
                                    .controlSize(.small)
                            }
                            Text(isSaving ? "Saving…" : "Save & Sync")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSaving || descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .opacity(descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
                }

                if saveSucceeded {
                    Label("Saved and synced to GitHub", systemImage: "checkmark.circle.fill")
                        .font(.footnote.weight(.medium))
                        .foregroundColor(Theme.accentGreen)
                }
            }
            .padding(10)
            .animation(.spring(duration: 0.3), value: isEditing)
        }
        .background(Color(uiColor: .systemBackground))
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(entry.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { editorFocused = false }
                    .font(.system(size: 15, weight: .semibold))
            }
        }
        .task { await loadExistingActivity() }
    }

    // MARK: - Stats card (hero header)

    private var statsCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Sport color stripe — anchors the view's identity immediately
            badge.color
                .frame(height: 3)
                .frame(maxWidth: .infinity)

            // Sport label + date + loading indicator
            HStack(spacing: 5) {
                Text(badge.label)
                    .font(.system(size: 10, weight: .bold))
                    .kerning(1)
                    .foregroundColor(badge.color)
                Text("·")
                    .font(.system(size: 10))
                    .foregroundColor(Color(uiColor: .tertiaryLabel))
                Text(formattedDate)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                Spacer()
                if isLoading { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 6)

            // Hero name — the biggest text on screen
            Text(entry.name)
                .font(.system(size: 22, weight: .bold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.bottom, 14)

            Divider().opacity(0.5)

            // Stats columns — large monospaced values
            HStack(spacing: 0) {
                HeroStat(value: durationString, label: "DURATION")
                if isLoading && activity == nil {
                    HeroStat(value: "420", label: "CAL")
                    HeroStat(value: "142", label: "AVG HR")
                    HeroStat(value: "171", label: "PEAK")
                } else {
                    if let cal = activity?.calories {
                        HeroStat(value: "\(cal)", label: "CAL")
                    }
                    if let hr = activity?.averageHeartrate {
                        HeroStat(value: "\(Int(hr))", label: "AVG HR")
                    }
                    if let peak = activity?.maxHeartrate {
                        HeroStat(value: "\(Int(peak))", label: "PEAK")
                    }
                    if let dist = activity?.distance, dist > 0 {
                        HeroStat(value: String(format: "%.1f", dist / 1000), label: "KM")
                    }
                }
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 8)
            .skeleton(isLoading && activity == nil)

            if let mental = activity?.preMentalState {
                Divider().opacity(0.5)
                MentalStateChip(score: mental.score, word: mental.word)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.cornerRadius)
                .stroke(Theme.cardBorder, lineWidth: 1)
        )
    }

    private var formattedDate: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.timeZone = .current
        guard let date = f.date(from: entry.startDateLocal) else { return entry.startDateLocal }
        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
    }

    private var durationString: String {
        let hours = entry.elapsedTime / 3600
        let minutes = (entry.elapsedTime % 3600) / 60
        return hours > 0 ? String(format: "%dh %02dm", hours, minutes) : String(format: "%dm", minutes)
    }

    // MARK: - Description display (read mode)

    /// Read-only description card. Three states:
    /// - saved description exists → render it, pencil to edit
    /// - no description yet → muted empty state with an add button
    /// Editing is entered via the pencil / add button.
    private var descriptionDisplayCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionHeader("Description")
                Spacer()
                Button {
                    startEditing()
                } label: {
                    Image(systemName: savedDescription == nil ? "plus.circle.fill" : "pencil.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(Theme.accentGreen)
                }
                .accessibilityLabel(savedDescription == nil ? "Add description" : "Edit description")
            }

            ThemedCard {
                if let desc = savedDescription {
                    Text(desc)
                        .font(.system(size: 13, design: .monospaced))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    // Empty state — visually distinct from a filled description.
                    VStack(spacing: 6) {
                        Image(systemName: "text.badge.plus")
                            .font(.system(size: 22))
                            .foregroundColor(.secondary)
                        Text(isLoading ? "Loading…" : "No description yet")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(.secondary)
                        if !isLoading && entry.sportType == "Badminton" {
                            Text("Tap + to add match scores")
                                .font(.caption2)
                                .foregroundColor(Theme.attentionOrange)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }
            }
        }
    }

    private func startEditing() {
        Haptics.tap()
        descriptionText = savedDescription ?? ""
        saveSucceeded = false
        errorMessage = nil
        isEditing = true
        editorFocused = true
    }

    // MARK: - Description editor (edit mode)

    private var editorCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionHeader("Description — Paste Scores")
                Spacer()
                Button {
                    editorFocused = false
                    isEditing = false
                    errorMessage = nil
                } label: {
                    Text("Cancel")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }

            TextEditor(text: $descriptionText)
                .font(.system(size: 14, design: .monospaced))
                .frame(minHeight: 150)
                .padding(8)
                .scrollContentBackground(.hidden)
                .background(Theme.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.cornerRadius)
                        .stroke(editorFocused ? Theme.accentGreen : Theme.cardBorder, lineWidth: 1)
                )
                .focused($editorFocused)
        }
    }

    // MARK: - Preview

    @ViewBuilder
    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader("Live Preview")

            ThemedCard {
                Group {
                    if let parsed {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(DescriptionParser.formatDescription(parsed))
                                .font(.system(size: 13, design: .monospaced))
                                .fixedSize(horizontal: false, vertical: true)

                            ForEach(parsed.warnings, id: \.self) { warning in
                                Label(warning, systemImage: "exclamationmark.triangle.fill")
                                    .font(.caption)
                                    .foregroundColor(Theme.attentionOrange)
                            }
                        }
                    } else if DescriptionParser.isAlreadyFormatted(descriptionText) {
                        Text(descriptionText)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundColor(.secondary)
                    } else if descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Paste scores above to see a preview.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        Text("No games recognized yet — keep typing or check the format.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }

    // MARK: - Data

    /// Loads the full activity — cache-first (issue #131).
    ///
    /// Freshly-synced entries carry the complete Activity payload in the local
    /// cache, exactly as committed. Using it avoids the GitHub Contents API
    /// read entirely, which can 404 or serve stale data for up to ~a minute
    /// after a branch reset + immediate Git Data API write (the "save fails on
    /// first sync, works after the second" bug). The network read remains as a
    /// fallback for legacy cache entries, and refreshes the cached copy when it
    /// succeeds.
    private func loadExistingActivity() async {
        // 1. Cache hit — render instantly, no spinner, no network.
        if let cached = entry.activity {
            activity = cached
            return
        }

        // 2. Legacy entry without a payload — fall back to the network, with a
        //    short retry for the propagation-delay window.
        isLoading = true
        defer { isLoading = false }
        do {
            let fetched = try await readActivityWithPropagationRetry()
            activity = fetched
            SyncCache.updateStats(fileName: entry.fileName, activity: fetched)
        } catch {
            errorMessage = "Could not load activity: \(error.localizedDescription)"
        }
    }

    /// Reads the activity from GitHub, retrying 404s twice with a short delay —
    /// a freshly-written file on a freshly-reset branch can 404 briefly even
    /// though the commit succeeded (Contents API propagation delay).
    private func readActivityWithPropagationRetry() async throws -> Activity {
        try await withPropagationRetry(operation: "Reading \(entry.fileName)") {
            try await apiClient.readActivity(fileName: entry.fileName)
        }
    }

    private func readEbaddersHistoryWithPropagationRetry() async throws -> [EbaddersEntry] {
        try await withPropagationRetry(operation: "Reading match history") {
            try await apiClient.readEbaddersHistory()
        }
    }

    /// Retries 404s twice with a 1.5s delay — covers GitHub's Contents API
    /// propagation window after a branch reset (issue #131). Non-404 errors
    /// surface immediately (the API client already retries transient ones).
    private func withPropagationRetry<T>(operation: String, _ body: () async throws -> T) async throws -> T {
        var lastError: Error?
        for attempt in 0..<3 {
            do {
                return try await body()
            } catch {
                lastError = error
                guard case GitHubAPIError.notFound = error, attempt < 2 else { throw error }
                try? await Task.sleep(nanoseconds: UInt64(1_500_000_000))
            }
        }
        throw lastError ?? GitHubAPIError.notFound(operation: operation)
    }

    private func saveAndSync() async {
        guard let parsed else {
            errorMessage = "Nothing to save yet — paste scores in a recognized format first."
            return
        }

        isSaving = true
        errorMessage = nil
        saveSucceeded = false
        defer { isSaving = false }

        do {
            let formatted = DescriptionParser.formatDescription(parsed)
            // Priority: in-memory (already loaded) → local cache payload →
            // network with propagation retry. The cache path is what makes
            // saving work immediately after a first sync on a fresh branch
            // (issue #131) — no Contents API read required at all.
            let currentActivity: Activity
            if let activity {
                currentActivity = activity
            } else if let cached = entry.activity {
                currentActivity = cached
            } else {
                currentActivity = try await readActivityWithPropagationRetry()
            }

            let updatedActivity = Activity(
                name: currentActivity.name,
                sportType: currentActivity.sportType,
                startDateLocal: currentActivity.startDateLocal,
                elapsedTime: currentActivity.elapsedTime,
                movingTime: currentActivity.movingTime,
                calories: currentActivity.calories,
                distance: currentActivity.distance,
                totalElevationGain: currentActivity.totalElevationGain,
                averageHeartrate: currentActivity.averageHeartrate,
                maxHeartrate: currentActivity.maxHeartrate,
                hasHeartrate: currentActivity.hasHeartrate,
                hrZones: currentActivity.hrZones,
                description: formatted,
                totalPhotoCount: currentActivity.totalPhotoCount,
                averageSpeed: currentActivity.averageSpeed,
                maxSpeed: currentActivity.maxSpeed,
                deviceName: currentActivity.deviceName,
                source: currentActivity.source,
                preMentalState: parsed.preMentalState.map { PreMentalState(score: $0.score, word: $0.word) } ?? currentActivity.preMentalState
            )

            // Dedupe ebadders_history.json by date (not activity_id — HealthKit
            // activities have no Strava id, so activity_id is always nil here).
            let dateStr = String(currentActivity.startDateLocal.prefix(10))
            let newEntry = DescriptionParser.buildStructuredEntry(parsed, date: dateStr, activityId: nil)

            // Must not silently swallow errors here: on any failure (network blip,
            // auth hiccup, etc.) falling back to `[]` would commit a fresh
            // ebadders_history.json containing only this one entry, destroying
            // every prior match record. Let real failures abort the save instead.
            // Same propagation-delay risk as the activity read: on a freshly
            // reset branch this file can briefly 404 even though it exists at
            // HEAD. Retry a couple of times before giving up — and never fall
            // back to [] (that would wipe all prior match records on commit).
            var history = try await readEbaddersHistoryWithPropagationRetry()
            history.removeAll { $0.date == dateStr }
            history.append(newEntry)
            history.sort { $0.date > $1.date }

            // Both files use .sortedKeys. Previously this file used a plain
            // JSONEncoder (no .sortedKeys) for ebadders_history.json, on the
            // assumption that EbaddersEntry/EbaddersMatch's custom encode(to:)
            // would make JSONEncoder emit keys in that same call order, matching
            // the Python pipeline's insertion order. That assumption is wrong:
            // Foundation's JSONEncoder does NOT guarantee call-order preservation
            // without .sortedKeys — its internal storage is unordered, and the
            // emitted key order follows Swift's hash-seeded Dictionary iteration,
            // which is randomized *per process launch*. Verified live: decoding
            // the real file and re-encoding without .sortedKeys produced a key
            // order matching neither alphabetical nor the declared field order.
            // That means every fresh app launch could scramble the whole file
            // into a *different* order on save — strictly worse than the
            // original .sortedKeys behavior, which is at least a one-time,
            // deterministic, stable-thereafter reorder. Using it for both files.
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let activityData = try encoder.encode(updatedActivity)
            let historyData = try encoder.encode(history)

            try await apiClient.commitFiles(
                [
                    (path: "user_data/activities/hist/\(entry.fileName)", data: activityData),
                    (path: "training/ebadders_history.json", data: historyData),
                ],
                message: "ios: add scores for \(currentActivity.name)"
            )

            // Persist the updated payload locally so the cache stays the source
            // of truth (also flips hasDescription) while GitHub catches up.
            SyncCache.updateActivity(fileName: entry.fileName, activity: updatedActivity)
            activity = updatedActivity
            saveSucceeded = true
            editorFocused = false
            isEditing = false
            Haptics.success()
        } catch {
            errorMessage = "Save failed: \(error.localizedDescription)"
            Haptics.error()
        }
    }

    // MARK: - HR Zone Breakdown

    /// Animated fill bars showing time distribution across HR zones.
    /// Only rendered when the loaded activity has hrZones data.
    @ViewBuilder
    private var zoneBreakdownSection: some View {
        if let zones = activity?.hrZones {
            let order = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]
            let labels = ["Z1", "Z2", "Z3", "Z4", "Z5"]
            let vals = order.map { zones[$0]?.seconds ?? 0 }
            let total = vals.reduce(0, +)
            if total > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    SectionHeader("Heart Rate Zones")
                    ThemedCard {
                        VStack(spacing: 10) {
                            ForEach(vals.indices, id: \.self) { i in
                                ZoneBreakdownRow(
                                    label: labels[i],
                                    color: Theme.hrZoneColors[i],
                                    fraction: vals[i] / total,
                                    seconds: Int(vals[i]),
                                    index: i
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Zone Breakdown Row

private struct ZoneBreakdownRow: View {
    let label: String
    let color: Color
    let fraction: Double
    let seconds: Int
    let index: Int

    @State private var appeared = false

    private var timeString: String {
        if seconds >= 3600 {
            let h = seconds / 3600, m = (seconds % 3600) / 60
            return "\(h)h \(m)m"
        } else if seconds >= 60 {
            let m = seconds / 60, s = seconds % 60
            return s > 0 ? "\(m)m \(s)s" : "\(m)m"
        } else {
            return "\(seconds)s"
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(color)
                .frame(width: 18, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color.opacity(0.12))
                        .frame(height: 8)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color)
                        .frame(width: appeared ? max(3, geo.size.width * fraction) : 0, height: 8)
                        .animation(
                            .spring(duration: 0.6, bounce: 0.1).delay(Double(index) * 0.06),
                            value: appeared
                        )
                }
            }
            .frame(height: 8)

            Text("\(Int(fraction * 100))%")
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(.secondary)
                .frame(width: 28, alignment: .trailing)

            Text(timeString)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.secondary)
                .frame(width: 50, alignment: .trailing)
        }
        .onAppear { appeared = true }
    }
}

// MARK: - Mental State Chip

private struct MentalStateChip: View {
    let score: Int
    let word: String

    private var color: Color {
        switch score {
        case 7...10: return Theme.accentGreen
        case 4...6:  return Theme.attentionOrange
        default:     return .red
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Text("PRE")
                .font(.system(size: 8, weight: .bold))
                .kerning(1)
                .foregroundColor(.secondary)
            Text("\(score) · \(word)")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(color)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.1))
        .clipShape(Capsule())
    }
}

// MARK: - Hero Stat

private struct HeroStat: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.system(size: 19, weight: .bold, design: .monospaced))
                .foregroundColor(.primary)
                .contentTransition(.numericText())
            Text(label)
                .font(.system(size: 8, weight: .bold))
                .kerning(1)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
