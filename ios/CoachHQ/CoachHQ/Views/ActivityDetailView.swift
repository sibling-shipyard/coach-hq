import SwiftUI

/// Shows a synced activity's stats and lets the user paste raw match scores,
/// previewing the parsed/formatted result live, then commits both the activity
/// file and `user_data/activities/match_history.json` to GitHub in one atomic commit.
///
/// Warm Instrument layout — inline back + title meta on desk, hero stats card,
/// quiet zone breakdown, coach's-read description treatment.
struct ActivityDetailView: View {
    let entry: SyncCacheEntry

    @EnvironmentObject var authManager: GitHubAuthManager
    @Environment(\.dismiss) private var dismiss

    @State private var activity: Activity?
    @State private var descriptionText: String = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var saveSucceeded = false
    @State private var saveCheckScale: CGFloat = 0.6
    @State private var isEditing = false
    @State private var statsRevealed: Bool
    @State private var statsProgress: Double = 0
    @FocusState private var editorFocused: Bool

    init(entry: SyncCacheEntry) {
        self.entry = entry
        let cached = entry.activity
        _activity = State(initialValue: cached)
        // Cached entries render at full opacity immediately — no fade on every push.
        _statsRevealed = State(initialValue: cached != nil)
        // Skip count-up for cache hits so stats never flash zero.
        _statsProgress = State(initialValue: cached != nil ? 1.0 : 0)
    }

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
            VStack(alignment: .leading, spacing: 14) {
                metaHeader
                statsCard
                zoneBreakdownSection

                Group {
                    if isEditing {
                        editorSection
                        previewSection
                    } else {
                        descriptionSection
                    }
                }
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .move(edge: .top)).combined(with: .scale(scale: 0.98)),
                    removal: .opacity.combined(with: .scale(scale: 0.98))
                ))

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(WarmInstrument.accent)
                }

                if isEditing {
                    WarmPrimaryCTA(title: isSaving ? "Saving…" : "Save & Sync") {
                        Task { await saveAndSync() }
                    }
                    .disabled(isSaving || descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .opacity(descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
                    .overlay {
                        if isSaving {
                            ProgressView()
                                .tint(WarmInstrument.paper)
                        }
                    }
                }

                if saveSucceeded {
                    Label("Saved and synced to GitHub", systemImage: "checkmark.circle.fill")
                        .font(.footnote.weight(.medium))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .scaleEffect(saveCheckScale)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 24)
            .safeAreaPadding(.bottom, 8)
            .animation(PremiumMotion.state, value: isEditing)
            .animation(PremiumMotion.reveal, value: saveSucceeded)
        }
        .scrollClipDisabled()
        .background(WarmInstrument.desk.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .toolbar(.hidden, for: .navigationBar)
        .hidesMainTabBar()
        .edgeBackSwipe { dismiss() }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { editorFocused = false }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Theme.ink)
            }
        }
        .task { await loadExistingActivity() }
        .onChange(of: isLoading) { _, loading in
            guard !loading else { return }
            withAnimation(PremiumMotion.statsLoad) { statsRevealed = true }
            withAnimation(.spring(duration: 0.7, bounce: 0.1).delay(0.1)) { statsProgress = 1.0 }
        }
        .onChange(of: saveSucceeded) { _, success in
            guard success else { return }
            saveCheckScale = 0.6
            withAnimation(.spring(duration: 0.35, bounce: 0.22)) {
                saveCheckScale = 1
            }
        }
    }

    // MARK: - Inline meta header (WorkoutOverview-style)

    private var metaHeader: some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                Haptics.tap()
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .padding(.top, 4)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 4) {
                Text(entry.name)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 5) {
                    MonoLabel(badge.label, size: 10, color: badge.color)
                    Text("·")
                        .font(.system(size: 10))
                        .foregroundColor(WarmInstrument.inkFaint)
                    Text(formattedDate)
                        .font(.system(size: 11))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
            }

            Spacer(minLength: 8)

            if isLoading {
                ProgressView()
                    .controlSize(.small)
                    .padding(.top, 4)
            }
        }
    }

    // MARK: - Hero stats card

    private var statsCard: some View {
        WarmCard(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 5) {
                        MonoLabel(badge.label, size: 10, color: badge.color)
                        Text("·")
                            .font(.system(size: 10))
                            .foregroundColor(WarmInstrument.inkFaint)
                        Text(formattedDate)
                            .font(.system(size: 11))
                            .foregroundColor(WarmInstrument.inkMuted)
                        Spacer()
                    }

                    HStack(spacing: 0) {
                        HeroStat(value: durationString, label: "DURATION")
                        if isLoading && activity == nil {
                            HeroStat(value: "420", label: "CAL")
                            HeroStat(value: "142", label: "AVG HR")
                            HeroStat(value: "171", label: "PEAK")
                        } else {
                            if let cal = activity?.calories {
                                HeroStat(value: "\(Int(Double(cal) * statsProgress))", label: "CAL")
                            }
                            if let hr = activity?.averageHeartrate {
                                HeroStat(value: "\(Int(hr * statsProgress))", label: "AVG HR")
                            }
                            if let peak = activity?.maxHeartrate {
                                HeroStat(value: "\(Int(peak * statsProgress))", label: "PEAK")
                            }
                            if let dist = activity?.distance, dist > 0 {
                                HeroStat(value: String(format: "%.1f", (dist / 1000) * statsProgress), label: "KM")
                            }
                        }
                    }
                    .skeleton(isLoading && activity == nil)
                    .opacity(statsRevealed ? 1 : 0.9)
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 12)

                if activity?.hrZones != nil, hrZoneTotal > 0 {
                    CompactZoneBar(
                        zones: activity?.hrZones,
                        height: 4,
                        rounded: false,
                        animateEntrance: entry.activity == nil
                    )
                }

                if let mental = activity?.preMentalState {
                    MentalStateChip(score: mental.score, word: mental.word)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                }
            }
        }
    }

    private var hrZoneTotal: Double {
        guard let zones = activity?.hrZones else { return 0 }
        let order = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]
        return order.reduce(0) { $0 + (zones[$1]?.seconds ?? 0) }
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

    // MARK: - Description (read mode — coach's read)

    private var descriptionSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                MonoLabel("Description")
                Spacer()
                Button {
                    startEditing()
                } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
                .buttonStyle(TimerWarmPressStyle())
                .accessibilityLabel(savedDescription == nil ? "Add description" : "Edit description")
            }

            WarmCard(padding: 16, fill: WarmInstrument.surfaceMuted) {
                if let desc = savedDescription {
                    Text(desc)
                        .font(descriptionFont(for: desc))
                        .foregroundColor(WarmInstrument.ink)
                        .lineSpacing(descriptionLineSpacing(for: desc))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text(emptyDescriptionPlaceholder)
                        .font(WarmInstrument.coachVoice(14.5))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .italic()
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                }
            }
        }
    }

    private var emptyDescriptionPlaceholder: String {
        if isLoading { return "Loading session notes…" }
        if entry.sportType == "Badminton" {
            return "No scores logged yet — tap the pencil to paste match results."
        }
        return "Nothing written down for this session yet."
    }

    private func descriptionFont(for text: String) -> Font {
        if DescriptionParser.isAlreadyFormatted(text) || text.contains(where: { $0.isNumber }) {
            return .system(size: 13, design: .monospaced)
        }
        return WarmInstrument.coachVoice(14.5)
    }

    private func descriptionLineSpacing(for text: String) -> CGFloat {
        DescriptionParser.isAlreadyFormatted(text) ? 0 : 3
    }

    private func startEditing() {
        Haptics.tap()
        descriptionText = savedDescription ?? ""
        saveSucceeded = false
        errorMessage = nil
        withAnimation(PremiumMotion.state) {
            isEditing = true
        }
        editorFocused = true
    }

    // MARK: - Description editor (edit mode)

    private var editorSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                MonoLabel("Description — paste scores")
                Spacer()
                Button {
                    withAnimation(PremiumMotion.state) {
                        editorFocused = false
                        isEditing = false
                        errorMessage = nil
                    }
                } label: {
                    Text("Cancel")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
            }

            WarmCard(padding: 0) {
                TextEditor(text: $descriptionText)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundColor(Theme.ink)
                    .frame(minHeight: 150)
                    .padding(12)
                    .scrollContentBackground(.hidden)
                    .focused($editorFocused)
            }
            .overlay(
                RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                    .stroke(editorFocused ? WarmInstrument.ink : WarmInstrument.border, lineWidth: 1)
            )
        }
    }

    // MARK: - Preview

    @ViewBuilder
    private var previewSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            MonoLabel("Live preview")

            WarmCard(padding: 16, fill: WarmInstrument.surfaceMuted) {
                Group {
                    if let parsed {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(DescriptionParser.formatDescription(parsed))
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundColor(Theme.ink)
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
                            .foregroundColor(WarmInstrument.inkMuted)
                    } else if descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Paste scores above to see a preview. Format:")
                                .font(WarmInstrument.coachVoice(13))
                                .foregroundColor(WarmInstrument.inkFaint)
                                .italic()
                            Text("Doubles: Partner me vs Opp1/Opp2 21-18\nSingles: me vs Opponent 21-18")
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(WarmInstrument.inkFaint)
                        }
                    } else {
                        Text("No games recognized yet — keep typing or check the format.")
                            .font(WarmInstrument.coachVoice(13))
                            .foregroundColor(WarmInstrument.inkFaint)
                            .italic()
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
        // statsProgress is already 1.0 from init, so no animation needed.
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
            errorMessage = UserFacingError.friendlyMessage(for: error)
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

    /// Loads match history for save, retrying transient 404s. A missing file (greenfield)
    /// becomes an empty v1 document — not an error.
    private func readMatchHistoryForSave() async throws -> MatchHistory {
        do {
            return try await withPropagationRetry(operation: "Reading match history") {
                try await apiClient.readMatchHistory()
            }
        } catch GitHubAPIError.notFound {
            return MatchHistory(version: 1, sessions: [])
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

            // Dedupe match_history.json by date (not activity_id — HealthKit
            // activities have no Strava id, so activity_id is always nil here).
            let dateStr = String(currentActivity.startDateLocal.prefix(10))
            let newEntry = DescriptionParser.buildStructuredEntry(parsed, date: dateStr, activityId: nil)

            // Retry transient 404s (Contents API propagation). If the file is still
            // missing after retries, treat as greenfield empty history — not a wipe
            // of existing data. Non-404 errors still abort the save.
            let history = try await readMatchHistoryForSave()
            var sessions = history.sessions
            sessions.removeAll { $0.date == dateStr }
            sessions.append(newEntry)
            sessions.sort { $0.date > $1.date }
            let updatedHistory = MatchHistory(version: 1, sessions: sessions)

            // Both files use .sortedKeys.
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let activityData = try encoder.encode(updatedActivity)
            let historyData = try encoder.encode(updatedHistory)

            try await apiClient.commitFiles(
                [
                    (path: "user_data/activities/hist/\(entry.fileName)", data: activityData),
                    (path: "user_data/activities/match_history.json", data: historyData),
                ],
                message: "ios: add scores for \(currentActivity.name)"
            )

            // Persist the updated payload locally so the cache stays the source
            // of truth (also flips hasDescription) while GitHub catches up.
            SyncCache.updateActivity(fileName: entry.fileName, activity: updatedActivity)
            activity = updatedActivity
            saveSucceeded = true
            withAnimation(PremiumMotion.state) {
                editorFocused = false
                isEditing = false
            }
            Haptics.success()
        } catch {
            errorMessage = UserFacingError.friendlyMessage(for: error)
            Haptics.error()
        }
    }

    // MARK: - HR Zone Breakdown

    /// Quiet hairline bars showing time distribution across HR zones.
    @ViewBuilder
    private var zoneBreakdownSection: some View {
        if let zones = activity?.hrZones {
            let order = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]
            let labels = ["Z1", "Z2", "Z3", "Z4", "Z5"]
            let vals = order.map { zones[$0]?.seconds ?? 0 }
            let total = vals.reduce(0, +)
            if total > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    CardKicker(label: "Heart rate zones")
                    WarmCard {
                        VStack(spacing: 10) {
                            ForEach(vals.indices, id: \.self) { i in
                                ZoneBreakdownRow(
                                    label: labels[i],
                                    color: Theme.hrZoneColors[i],
                                    fraction: vals[i] / total,
                                    seconds: Int(vals[i]),
                                    animateEntrance: entry.activity == nil
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
    var animateEntrance: Bool = true
    @State private var appeared: Bool

    init(
        label: String,
        color: Color,
        fraction: Double,
        seconds: Int,
        animateEntrance: Bool = true
    ) {
        self.label = label
        self.color = color
        self.fraction = fraction
        self.seconds = seconds
        self.animateEntrance = animateEntrance
        _appeared = State(initialValue: !animateEntrance)
    }

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
            MonoLabel(label, size: 9, color: color)
                .frame(width: 20, alignment: .leading)

            HairlineProgress(
                fraction: appeared ? fraction : 0,
                tint: color,
                track: color.opacity(0.12),
                height: 3
            )
            .animation(PremiumMotion.statsLoad, value: appeared)

            Text("\(Int(fraction * 100))%")
                .font(WarmInstrument.figures(10))
                .foregroundColor(WarmInstrument.inkMuted)
                .frame(width: 28, alignment: .trailing)

            Text(timeString)
                .font(WarmInstrument.figures(10))
                .foregroundColor(WarmInstrument.inkFaint)
                .frame(width: 48, alignment: .trailing)
        }
        .onAppear {
            guard animateEntrance else { return }
            appeared = true
        }
        .onDisappear {
            guard animateEntrance else { return }
            appeared = false
        }
    }
}

// MARK: - Mental State Chip

private struct MentalStateChip: View {
    let score: Int
    let word: String

    var body: some View {
        HStack(spacing: 6) {
            MonoLabel("Pre-session", size: 8)
            Text("\(score) · \(word)")
                .font(WarmInstrument.coachVoice(12.5))
                .foregroundColor(WarmInstrument.ink)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WarmInstrument.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

// MARK: - Hero Stat

private struct HeroStat: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 17, weight: .bold, design: .monospaced))
                .foregroundColor(Theme.ink)
                .contentTransition(.numericText())
            MonoLabel(label, size: 8)
        }
        .frame(maxWidth: .infinity)
    }
}
