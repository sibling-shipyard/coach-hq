import SwiftUI

/// Shows a synced activity's stats and (for Badminton) lets the user log match scores.
/// Layout: headerBar (full-bleed) → hero stats → zone donut → HR context → zone breakdown → mental state → scores.

private let hrZoneKeys   = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]
private let hrZoneShorts = ["Z1", "Z2", "Z3", "Z4", "Z5"]
private let hrZoneNames  = ["Recovery", "Base", "Aerobic", "Threshold", "VO₂ Max"]
struct ActivityDetailView: View {
    let entry: SyncCacheEntry

    @EnvironmentObject var authManager: GitHubAuthManager
    @Environment(\.dismiss) private var dismiss

    @State private var activity: Activity?
    @State private var descriptionText: String = ""
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var statsRevealed: Bool
    @State private var statsProgress: Double = 0
    @State private var showingScoreSheet = false
    @State private var toast: Toast?
    @State private var isSavingCategory = false

    init(entry: SyncCacheEntry) {
        self.entry = entry
        let cached = entry.activity
        _activity = State(initialValue: cached)
        _statsRevealed = State(initialValue: cached != nil)
        _statsProgress = State(initialValue: cached != nil ? 1.0 : 0)
    }

    private var savedDescription: String? {
        guard let desc = activity?.description, !desc.isEmpty else { return nil }
        return desc
    }

    private var supportsScoreEntry: Bool {
        Theme.sportSupportsScoreEntry(for: entry.sportType)
    }

    private var apiClient: GitHubAPIClient {
        // targetBranch is governed by TestModeManager — don't override here.
        // Previously this forced "main" unconditionally, silently bypassing test mode.
        GitHubAPIClient(authManager: authManager)
    }

    private var badge: (label: String, color: Color) {
        Theme.sportBadge(for: entry.sportType)
    }

    private var parsed: ParsedDescription? {
        DescriptionParser.parseRawDescription(descriptionText)
    }

    private var hrZoneTotal: Double {
        guard let zones = activity?.hrZones else { return 0 }
        return hrZoneKeys.reduce(0) { $0 + (zones[$1]?.seconds ?? 0) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                headerBar

                VStack(alignment: .leading, spacing: 14) {
                    heroCard
                    zoneDonutSection
                    hrContextSection
                    zoneBreakdownSection
                    mentalStateSection
                    if supportsScoreEntry { scoreSection }
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(WarmInstrument.accent)
                            .padding(.horizontal, 4)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 32)
                .safeAreaPadding(.bottom, 8)
            }
        }
        .scrollClipDisabled()
        .background(WarmInstrument.desk.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .hidesMainTabBar()
        .edgeBackSwipe { dismiss() }
        .toast($toast)
        .sheet(isPresented: $showingScoreSheet) {
            ScoreEntrySheet(
                entry: entry,
                descriptionText: $descriptionText,
                isSaving: $isSaving,
                errorMessage: $errorMessage,
                onSave: { await saveAndSync() }
            )
        }
        .task { await loadExistingActivity() }
        .onChange(of: isLoading) { _, loading in
            guard !loading else { return }
            withAnimation(PremiumMotion.statsLoad) { statsRevealed = true }
            withAnimation(.spring(duration: 0.7, bounce: 0.1).delay(0.1)) { statsProgress = 1.0 }
        }
    }

    // MARK: - Header bar (full-bleed, matches EngineDetailView)

    private var headerBar: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Button {
                Haptics.tap()
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
            .buttonStyle(.plain)

            Text(entry.name)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
                .lineLimit(1)

            Spacer(minLength: 8)

            if isLoading {
                ProgressView().controlSize(.small)
            } else {
                categoryMenuChip
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(WarmInstrument.headerRule).frame(height: 1)
        }
    }

    // MARK: - Hero card (stats)

    private var heroCard: some View {
        WarmCard(padding: 0) {
            VStack(spacing: 0) {
                badge.color
                    .frame(maxWidth: .infinity)
                    .frame(height: 6)

                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        MonoLabel(badge.label)
                        Spacer()
                        MonoLabel(formattedDate, size: 9, color: WarmInstrument.inkFaint)
                    }
                    .padding(.bottom, 12)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(durationString)
                            .font(.system(size: 38, weight: .bold, design: .monospaced))
                            .foregroundColor(Theme.ink)
                            .contentTransition(.numericText())
                            .opacity(statsRevealed ? 1 : 0.9)
                        MonoLabel("Duration", size: 9)
                    }
                    .padding(.bottom, 16)

                    WarmInstrument.border
                        .frame(maxWidth: .infinity)
                        .frame(height: 1)

                    HStack(spacing: 0) {
                        if isLoading && activity == nil {
                            SupportingStatCell(value: "—", label: "CAL")
                            SupportingStatCell(value: "—", label: "AVG HR")
                            SupportingStatCell(value: "—", label: "PEAK")
                        } else {
                            if let cal = activity?.calories {
                                SupportingStatCell(value: "\(Int(Double(cal) * statsProgress))", label: "CAL")
                            }
                            if let hr = activity?.averageHeartrate {
                                SupportingStatCell(value: "\(Int(hr * statsProgress))", label: "AVG HR")
                            }
                            if let peak = activity?.maxHeartrate {
                                SupportingStatCell(value: "\(Int(peak * statsProgress))", label: "PEAK")
                            }
                            if let dist = activity?.distance, dist > 0 {
                                SupportingStatCell(
                                    value: String(format: "%.1f", (dist / 1000) * statsProgress),
                                    label: "KM"
                                )
                            }
                        }
                    }
                    .skeleton(isLoading && activity == nil)
                    .padding(.vertical, 12)
                }
                .padding(.horizontal, 16)
                .padding(.top, 14)
            }
        }
        .staggerReveal(delay: 0.05)
    }

    // MARK: - Widget A: Zone Donut

    @ViewBuilder
    private var zoneDonutSection: some View {
        if let zones = activity?.hrZones, hrZoneTotal > 0 {
            let vals = hrZoneKeys.map { zones[$0]?.seconds ?? 0 }
            let total = vals.reduce(0, +)
            let fracs = vals.map { $0 / total }
            let sortedIndices = fracs.indices
                .filter { fracs[$0] > 0.01 }
                .sorted { fracs[$0] > fracs[$1] }
                .prefix(4)
                .map { $0 }

            WarmCard {
                VStack(alignment: .leading, spacing: 14) {
                    MonoLabel("ZONE DISTRIBUTION")

                    HStack(spacing: 20) {
                        ZoneDonut(fractions: fracs)
                            .frame(width: 110, height: 110)

                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(sortedIndices, id: \.self) { i in
                                HStack(spacing: 8) {
                                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                                        .fill(Theme.hrZoneColors[i])
                                        .frame(width: 8, height: 8)
                                    Text(hrZoneNames[i])
                                        .font(.system(size: 12.5, weight: .medium))
                                        .foregroundColor(WarmInstrument.ink)
                                    Spacer(minLength: 4)
                                    Text("\(Int((fracs[i] * 100).rounded()))%")
                                        .font(WarmInstrument.figures(11))
                                        .foregroundColor(Theme.hrZoneColors[i])
                                }
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .staggerReveal(delay: 0.10)
        }
    }

    // MARK: - Widget B: HR Context Bar

    @ViewBuilder
    private var hrContextSection: some View {
        if let zones = activity?.hrZones,
           let avg = activity?.averageHeartrate,
           let peak = activity?.maxHeartrate,
           hrZoneTotal > 0 {
            HRContextCard(zones: zones, avgHR: avg, peakHR: peak)
                .staggerReveal(delay: 0.15)
        }
    }

    // MARK: - Widget C: HR Zone breakdown

    @ViewBuilder
    private var zoneBreakdownSection: some View {
        if let zones = activity?.hrZones {
            let vals = hrZoneKeys.map { zones[$0]?.seconds ?? 0 }
            let total = vals.reduce(0, +)
            if total > 0 {
                WarmCard(padding: 0) {
                    VStack(spacing: 0) {
                        CompactZoneBar(
                            zones: zones,
                            height: 10,
                            rounded: false,
                            animateEntrance: entry.activity == nil
                        )

                        VStack(alignment: .leading, spacing: 14) {
                            MonoLabel("TIME IN ZONE")
                            VStack(spacing: 10) {
                                ForEach(vals.indices, id: \.self) { i in
                                    ZoneBreakdownRow(
                                        label: hrZoneShorts[i],
                                        name: hrZoneNames[i],
                                        color: Theme.hrZoneColors[i],
                                        fraction: vals[i] / total,
                                        seconds: Int(vals[i]),
                                        animateEntrance: entry.activity == nil
                                    )
                                }
                            }
                        }
                        .padding(16)
                    }
                }
                .staggerReveal(delay: 0.20)
            }
        }
    }

    // MARK: - Mental state section

    @ViewBuilder
    private var mentalStateSection: some View {
        if let mental = activity?.preMentalState {
            WarmCard {
                VStack(alignment: .leading, spacing: 12) {
                    MonoLabel("PRE-SESSION")

                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .stroke(mentalScoreColor(mental.score).opacity(0.12), lineWidth: 5)
                            Circle()
                                .trim(from: 0, to: CGFloat(mental.score) / 10.0)
                                .stroke(
                                    mentalScoreColor(mental.score),
                                    style: StrokeStyle(lineWidth: 5, lineCap: .round)
                                )
                                .rotationEffect(.degrees(-90))
                            Text("\(mental.score)")
                                .font(WarmInstrument.figures(16, weight: .bold))
                                .foregroundColor(mentalScoreColor(mental.score))
                        }
                        .frame(width: 48, height: 48)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(mental.word.prefix(1).uppercased() + mental.word.dropFirst())
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(WarmInstrument.ink)
                            Text("Mental readiness before the session")
                                .font(.system(size: 11))
                                .foregroundColor(WarmInstrument.inkMuted)
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
            .staggerReveal(delay: 0.25)
        }
    }

    private func mentalScoreColor(_ score: Int) -> Color {
        switch score {
        case 8...10: return Theme.accentGreen
        case 5...7:  return Theme.attentionOrange
        default:     return WarmInstrument.accent
        }
    }

    // MARK: - Score section (Badminton only)

    private var scoreSection: some View {
        Group {
            if let desc = savedDescription {
                Button { openScoreSheet() } label: {
                    WarmCard(padding: 16, fill: WarmInstrument.surfaceMuted) {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                MonoLabel("MATCH SCORES")
                                Spacer()
                                Image(systemName: "pencil")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundColor(WarmInstrument.inkFaint)
                            }
                            Text(desc)
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundColor(WarmInstrument.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .buttonStyle(TimerWarmPressStyle())
            } else {
                Button { openScoreSheet() } label: {
                    WarmCard(padding: 16, dashed: true) {
                        VStack(alignment: .leading, spacing: 12) {
                            MonoLabel("MATCH SCORES")
                            HStack(spacing: 12) {
                                Image(systemName: "figure.badminton")
                                    .font(.system(size: 22, weight: .medium))
                                    .foregroundColor(badge.color)
                                    .frame(width: 30)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Log match scores")
                                        .font(.system(size: 14, weight: .semibold))
                                        .foregroundColor(Theme.ink)
                                    Text("Paste your results from this session")
                                        .font(.system(size: 12))
                                        .foregroundColor(WarmInstrument.inkMuted)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundColor(WarmInstrument.inkFaint)
                            }
                        }
                    }
                }
                .buttonStyle(TimerWarmPressStyle())
            }
        }
        .staggerReveal(delay: 0.30)
    }

    private func openScoreSheet() {
        Haptics.tap()
        descriptionText = savedDescription ?? ""
        errorMessage = nil
        showingScoreSheet = true
    }

    // MARK: - Category

    @ViewBuilder
    private var categoryMenuChip: some View {
        if let options = Theme.categoryOptions(for: entry.sportType) {
            let current = activity?.category
            Menu {
                ForEach(options, id: \.code) { opt in
                    Button {
                        Haptics.tap()
                        Task { await saveCategory(opt.code) }
                    } label: {
                        if current == opt.code {
                            Label(opt.label, systemImage: "checkmark")
                        } else {
                            Text(opt.label)
                        }
                    }
                }
                if current != nil {
                    Divider()
                    Button(role: .destructive) {
                        Haptics.tap()
                        Task { await saveCategory(nil) }
                    } label: {
                        Label("Remove tag", systemImage: "xmark")
                    }
                }
            } label: {
                categoryChipLabel(current: current)
            }
            .disabled(isSavingCategory || activity == nil)
        }
    }

    @ViewBuilder
    private func categoryChipLabel(current: String?) -> some View {
        if let current {
            Text(current)
                .font(WarmInstrument.monoLabel(10))
                .tracking(1.0)
                .foregroundColor(WarmInstrument.inkMuted)
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .overlay(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(WarmInstrument.border, lineWidth: 1)
                )
                .opacity(isSavingCategory ? 0.5 : 1)
        } else {
            Image(systemName: "tag")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(WarmInstrument.inkFaint)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .overlay(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(WarmInstrument.inkFaint.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                )
        }
    }

    private func saveCategory(_ code: String?) async {
        isSavingCategory = true
        defer { isSavingCategory = false }
        do {
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
                category: code,
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
                description: currentActivity.description,
                totalPhotoCount: currentActivity.totalPhotoCount,
                averageSpeed: currentActivity.averageSpeed,
                maxSpeed: currentActivity.maxSpeed,
                deviceName: currentActivity.deviceName,
                source: currentActivity.source,
                sourceApp: currentActivity.sourceApp,
                preMentalState: currentActivity.preMentalState,
                activityId: currentActivity.activityId,
                idStr: currentActivity.idStr
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(updatedActivity)
            try await apiClient.commitFiles(
                [(path: "user_data/activities/hist/\(entry.fileName)", data: data)],
                message: code.map { "ios: tag \(currentActivity.name) [\($0)]" } ?? "ios: remove category from \(currentActivity.name)"
            )
            SyncCache.updateActivity(fileName: entry.fileName, activity: updatedActivity)
            activity = updatedActivity
            toast = Toast(kind: .success, message: code.map { "Tagged \($0)" } ?? "Category removed")
            Haptics.success()
        } catch {
            errorMessage = UserFacingError.friendlyMessage(for: error)
            Haptics.error()
        }
    }

    // MARK: - Helpers

    private var formattedDate: String {
        guard let date = Self.isoParser.date(from: entry.startDateLocal) else { return entry.startDateLocal }
        return Self.shortDateFormatter.string(from: date).uppercased()
    }

    private static let isoParser: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.timeZone = .current
        return f
    }()

    private static let shortDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "E · d MMM"
        return f
    }()

    private var durationString: String {
        let hours = entry.elapsedTime / 3600
        let minutes = (entry.elapsedTime % 3600) / 60
        return hours > 0 ? String(format: "%dh %02dm", hours, minutes) : String(format: "%dm", minutes)
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
        if let cached = entry.activity {
            activity = cached
            return
        }
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
        defer { isSaving = false }

        do {
            let formatted = DescriptionParser.formatDescription(parsed)
            // Cache-first order (#131): in-memory state → entry.activity (freshly synced) → network.
            // Avoids a GitHub Contents API read that can 404 for ~60s after a branch reset.
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
                category: currentActivity.category,
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
                sourceApp: currentActivity.sourceApp,
                preMentalState: parsed.preMentalState.map {
                    PreMentalState(score: $0.score, word: $0.word)
                } ?? currentActivity.preMentalState,
                activityId: currentActivity.activityId,
                idStr: currentActivity.idStr
            )

            let dateStr = String(currentActivity.startDateLocal.prefix(10))
            let newEntry = DescriptionParser.buildStructuredEntry(parsed, date: dateStr, activityId: nil)

            let history = try await readMatchHistoryForSave()
            var sessions = history.sessions
            sessions.removeAll { $0.date == dateStr }
            sessions.append(newEntry)
            sessions.sort { $0.date > $1.date }
            let updatedHistory = MatchHistory(version: 1, sessions: sessions)
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

            SyncCache.updateActivity(fileName: entry.fileName, activity: updatedActivity)
            activity = updatedActivity
            showingScoreSheet = false
            toast = Toast(kind: .success, message: "Saved and synced to GitHub")
            Haptics.success()
        } catch {
            errorMessage = UserFacingError.friendlyMessage(for: error)
            Haptics.error()
        }
    }
}

// MARK: - Score entry sheet

private struct ScoreEntrySheet: View {
    let entry: SyncCacheEntry
    @Binding var descriptionText: String
    @Binding var isSaving: Bool
    @Binding var errorMessage: String?
    let onSave: () async -> Void

    @FocusState private var editorFocused: Bool
    @Environment(\.dismiss) private var dismiss

    private var badge: (label: String, color: Color) {
        Theme.sportBadge(for: entry.sportType)
    }

    private var parsed: ParsedDescription? {
        DescriptionParser.parseRawDescription(descriptionText)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                sheetHeader
                editorSection
                previewSection
                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(WarmInstrument.accent)
                        .padding(.horizontal, 4)
                }
                WarmPrimaryCTA(title: isSaving ? "Saving…" : "Save & Sync") {
                    Task { await onSave() }
                }
                .disabled(isSaving || descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
                .overlay {
                    if isSaving { ProgressView().tint(WarmInstrument.paper) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 32)
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .presentationDragIndicator(.visible)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { editorFocused = false }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Theme.ink)
            }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { editorFocused = true }
        }
    }

    private var sheetHeader: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Log Match Scores")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(Theme.ink)
                HStack(spacing: 5) {
                    MonoLabel(badge.label, size: 9, color: badge.color)
                    Text("·").font(.system(size: 9)).foregroundColor(WarmInstrument.inkFaint)
                    Text(entry.name).font(.system(size: 11)).foregroundColor(WarmInstrument.inkMuted).lineLimit(1)
                }
            }
            Spacer(minLength: 12)
            Button { Haptics.tap(); dismiss() } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 22))
                    .symbolRenderingMode(.hierarchical)
                    .foregroundColor(WarmInstrument.inkMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
    }

    private var editorSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            MonoLabel("Paste scores")
            WarmCard(padding: 0) {
                TextEditor(text: $descriptionText)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundColor(Theme.ink)
                    .frame(minHeight: 160)
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
}

// MARK: - Widget A: Zone Donut

/// Animated donut ring where each zone is an arc segment, staggered on appear.
private struct ZoneDonut: View {
    let fractions: [Double]

    @State private var appeared = false

    private var arcs: [(start: Double, end: Double)] {
        var result: [(Double, Double)] = []
        var cursor: Double = 0
        for f in fractions {
            result.append((cursor, cursor + f))
            cursor += f
        }
        return result
    }

    private var dominantIndex: Int {
        fractions.enumerated().max(by: { $0.element < $1.element })?.offset ?? 0
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(WarmInstrument.surfaceMuted, lineWidth: 18)

            ForEach(arcs.indices, id: \.self) { i in
                let f = fractions[i]
                if f > 0.005 {
                    let gap = min(0.012, f * 0.15)
                    Circle()
                        .trim(
                            from: CGFloat(arcs[i].start + gap),
                            to: CGFloat(appeared ? arcs[i].end - gap : arcs[i].start + gap)
                        )
                        .stroke(
                            Theme.hrZoneColors[i],
                            style: StrokeStyle(lineWidth: 18, lineCap: .butt)
                        )
                        .rotationEffect(.degrees(-90))
                        .animation(
                            .spring(duration: 0.55, bounce: 0.08).delay(Double(i) * 0.06),
                            value: appeared
                        )
                }
            }

            VStack(spacing: 2) {
                Text(hrZoneNames[dominantIndex])
                    .font(WarmInstrument.monoLabel(9))
                    .foregroundColor(Theme.hrZoneColors[dominantIndex])
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                MonoLabel("dominant", size: 7)
            }
            .frame(width: 68)
        }
        .onAppear { appeared = true }
    }
}

// MARK: - Widget B: HR Context Card

/// Full-width colored zone bar showing where avg and peak HR fall within the zone scale.
private struct HRContextCard: View {
    let zones: [String: HRZoneEntry]
    let avgHR: Double
    let peakHR: Double

    // Derived from actual HR so markers sit away from the edges of the bar.
    private var displayMin: Double { max(40, floor((min(avgHR, peakHR) - 30) / 10) * 10) }
    private var displayMax: Double { min(230, ceil((peakHR + 20) / 10) * 10) }
    private let order = hrZoneKeys

    private var zoneFractions: [Double] {
        order.enumerated().map { i, key in
            let entry = zones[key]
            let lo: Double = i == 0 ? displayMin : Double(entry?.low ?? Int(displayMin))
            let hi: Double = i == 4 ? displayMax : Double(entry?.high ?? Int(displayMax))
            return max(0, min(hi, displayMax) - max(lo, displayMin)) / (displayMax - displayMin)
        }
    }

    private func barFraction(for bpm: Double) -> Double {
        max(0, min(1, (bpm - displayMin) / (displayMax - displayMin)))
    }

    private func zoneIndex(for bpm: Double) -> Int {
        for (i, key) in order.enumerated() {
            if let entry = zones[key] {
                if let high = entry.high { if bpm <= Double(high) { return i } }
                else { return i }
            }
        }
        return 4
    }

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    MonoLabel("HEART RATE RANGE")
                    Spacer()
                    Text("\(Int(avgHR))→\(Int(peakHR)) BPM")
                        .font(WarmInstrument.monoLabel(9, weight: .regular))
                        .foregroundColor(WarmInstrument.inkFaint)
                }

                GeometryReader { geo in
                    let w = geo.size.width
                    ZStack(alignment: .leading) {
                        HStack(spacing: 0) {
                            ForEach(zoneFractions.indices, id: \.self) { i in
                                Theme.hrZoneColors[i]
                                    .frame(width: max(1, w * CGFloat(zoneFractions[i])))
                            }
                        }
                        .frame(height: 22)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))

                        Capsule()
                            .fill(WarmInstrument.paper)
                            .frame(width: 2, height: 26)
                            .offset(x: w * CGFloat(barFraction(for: avgHR)) - 1)

                        Capsule()
                            .fill(WarmInstrument.paper)
                            .frame(width: 2, height: 26)
                            .offset(x: w * CGFloat(barFraction(for: peakHR)) - 1)
                    }
                }
                .frame(height: 26)

                HStack(spacing: 20) {
                    HRMarkerLabel(
                        title: "Avg",
                        bpm: Int(avgHR),
                        color: Theme.hrZoneColors[zoneIndex(for: avgHR)]
                    )
                    HRMarkerLabel(
                        title: "Peak",
                        bpm: Int(peakHR),
                        color: Theme.hrZoneColors[zoneIndex(for: peakHR)]
                    )
                    Spacer()
                }
            }
        }
    }
}

private struct HRMarkerLabel: View {
    let title: String
    let bpm: Int
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(color)
                .frame(width: 2, height: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(title.uppercased())
                    .font(WarmInstrument.monoLabel(8, weight: .regular))
                    .foregroundColor(WarmInstrument.inkFaint)
                Text("\(bpm) bpm")
                    .font(WarmInstrument.figures(12, weight: .semibold))
                    .foregroundColor(color)
            }
        }
    }
}

// MARK: - Zone breakdown row

private struct ZoneBreakdownRow: View {
    let label: String
    let name: String
    let color: Color
    let fraction: Double
    let seconds: Int
    var animateEntrance: Bool = true
    @State private var appeared: Bool

    init(label: String, name: String, color: Color, fraction: Double, seconds: Int, animateEntrance: Bool = true) {
        self.label = label
        self.name = name
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
            HStack(spacing: 5) {
                MonoLabel(label, size: 9, color: color)
                    .frame(width: 20, alignment: .leading)
                Text(name)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(WarmInstrument.inkFaint)
            }
            .frame(width: 82, alignment: .leading)

            HairlineProgress(
                fraction: appeared ? fraction : 0,
                tint: color,
                track: color.opacity(0.12),
                height: 6
            )
            .animation(PremiumMotion.statsLoad, value: appeared)

            HStack(spacing: 0) {
                Text("\(Int(fraction * 100))%")
                    .font(WarmInstrument.figures(10))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .frame(width: 32, alignment: .trailing)
                Text(timeString)
                    .font(WarmInstrument.figures(10))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .frame(width: 50, alignment: .trailing)
            }
        }
        .onAppear { guard animateEntrance else { return }; appeared = true }
        .onDisappear { guard animateEntrance else { return }; appeared = false }
    }
}

// MARK: - Supporting stat cell

private struct SupportingStatCell: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Text(value)
                .font(WarmInstrument.figures(15, weight: .semibold))
                .foregroundColor(Theme.ink)
                .contentTransition(.numericText())
            MonoLabel(label, size: 8)
        }
        .frame(maxWidth: .infinity)
    }
}
