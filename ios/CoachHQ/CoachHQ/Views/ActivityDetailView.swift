import SwiftUI

/// Shows a synced activity's stats and (for Badminton) lets the user log match scores.
/// Layout: headerBar → Beat 01 hero → Beat 02 ribbon → Beat 03 vs-usual → Beat 04 scores

private let hrZoneKeys  = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"]
private let hrZoneNames = ["Recovery", "Base", "Aerobic", "Threshold", "VO₂ Max"]

/// Earthy zone palette matching the mock — Recovery (sage) through VO₂ Max (terracotta).
/// Intentionally separate from Theme.hrZoneColors (used in widgets) so each surface
/// can evolve independently.
private let detailZoneColors: [Color] = [
    Color(red: 0xc3/255, green: 0xd1/255, blue: 0xc8/255), // Z1 Recovery  #c3d1c8
    Color(red: 0xad/255, green: 0xc2/255, blue: 0xb7/255), // Z2 Base      #adc2b7
    Color(red: 0x31/255, green: 0x5a/255, blue: 0x4a/255), // Z3 Aerobic   #315a4a
    Color(red: 0xa8/255, green: 0x70/255, blue: 0x2c/255), // Z4 Threshold #a8702c
    Color(red: 0x7f/255, green: 0x37/255, blue: 0x28/255), // Z5 VO₂ Max   #7f3728
]

private let matchWinColor  = Color(red: 0x1A/255, green: 0x47/255, blue: 0x31/255) // deep green
private let matchLossColor = Color(red: 0xa3/255, green: 0x46/255, blue: 0x2c/255) // warm red

struct ActivityDetailView: View {
    let entry: SyncCacheEntry

    @EnvironmentObject var authManager: GitHubAuthManager
    @Environment(\.dismiss) private var dismiss

    @State private var activity: Activity?
    @State private var hrStream: HRStreamFile?
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

    // MARK: - Body

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                headerBar
                VStack(alignment: .leading, spacing: 14) {
                    heroCard
                    ribbonCard
                    usualCard
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

    // MARK: - Header bar

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

    // MARK: - Beat 01: What it was

    private var heroCard: some View {
        WarmCard(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                MonoLabel(heroDateString, size: 9.5, color: WarmInstrument.inkFaint)
                    .padding(.bottom, 12)

                Text(durationString)
                    .font(.system(size: 52, weight: .semibold))
                    .kerning(-2.6)
                    .foregroundColor(Theme.ink)
                    .contentTransition(.numericText())
                    .opacity(statsRevealed ? 1 : 0.9)
                    .padding(.bottom, 16)

                WarmInstrument.border
                    .frame(maxWidth: .infinity)
                    .frame(height: 1)

                HStack(spacing: 0) {
                    if isLoading && activity == nil {
                        SupportingStatCell(value: "—", label: "KCAL")
                        SupportingStatCell(value: "—", label: "AVG BPM")
                        SupportingStatCell(value: "—", label: "PEAK BPM")
                    } else {
                        if let cal = activity?.calories {
                            SupportingStatCell(
                                value: "\(Int(Double(cal) * statsProgress))",
                                label: "KCAL"
                            )
                        }
                        if let hr = activity?.averageHeartrate {
                            SupportingStatCell(
                                value: "\(Int(hr * statsProgress))",
                                label: "AVG BPM"
                            )
                        }
                        if let peak = activity?.maxHeartrate {
                            SupportingStatCell(
                                value: "\(Int(peak * statsProgress))",
                                label: "PEAK BPM"
                            )
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
                .padding(.top, 12)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .staggerReveal(delay: 0.05)
    }

    // MARK: - Beat 02: How it was spent

    @ViewBuilder
    private var ribbonCard: some View {
        if let zones = activity?.hrZones, hrZoneTotal > 0 {
            WarmCard {
                VStack(alignment: .leading, spacing: 13) {
                    if let stream = hrStream, !stream.points.isEmpty {
                        MonoLabel("HEART RATE")
                        HRCurveView(stream: stream, zoneColors: detailZoneColors, config: .current)
                    } else {
                        MonoLabel("HOW IT WAS SPENT")
                        zoneDistributionBar(zones: zones)
                    }
                    zoneLegend(zones: zones)
                }
            }
            .staggerReveal(delay: 0.10)
        }
    }

    /// Zone totals as a proportion bar, zones in order.
    ///
    /// This replaced a ribbon that shuffled zone totals into a plausible-looking *time* order
    /// with a seeded RNG. It read as a session narrative and was not one — we only ever had
    /// totals. Ordered left-to-right by zone, it says exactly what it knows. The real ordering
    /// is the curve above, when a stream sidecar exists for the activity.
    private func zoneDistributionBar(zones: [String: HRZoneEntry]) -> some View {
        let total = hrZoneKeys.reduce(0.0) { $0 + (zones[$1]?.seconds ?? 0) }
        return GeometryReader { geo in
            HStack(spacing: 1.5) {
                ForEach(hrZoneKeys.indices, id: \.self) { i in
                    let secs = zones[hrZoneKeys[i]]?.seconds ?? 0
                    if secs > 0 {
                        detailZoneColors[i]
                            .frame(width: max(2, geo.size.width * CGFloat(secs / max(total, 1))))
                    }
                }
            }
        }
        .frame(height: 64)
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
        .accessibilityLabel("Time in each heart rate zone, shown in proportion.")
    }

    @ViewBuilder
    private func zoneLegend(zones: [String: HRZoneEntry]) -> some View {
        let items: [(index: Int, name: String, secs: Double)] = hrZoneKeys.indices.compactMap { i in
            let s = zones[hrZoneKeys[i]]?.seconds ?? 0
            return s > 0 ? (i, hrZoneNames[i].uppercased(), s) : nil
        }
        let row1 = Array(items.prefix(3))
        let row2 = Array(items.dropFirst(3))

        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 13) {
                ForEach(row1, id: \.index) { item in
                    zoneLegendChip(index: item.index, name: item.name, secs: item.secs)
                }
                Spacer(minLength: 0)
            }
            if !row2.isEmpty {
                HStack(spacing: 13) {
                    ForEach(row2, id: \.index) { item in
                        zoneLegendChip(index: item.index, name: item.name, secs: item.secs)
                    }
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private func zoneLegendChip(index: Int, name: String, secs: Double) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(detailZoneColors[index])
                .frame(width: 7, height: 7)
            Text(name)
                .font(WarmInstrument.monoLabel(9, weight: .regular))
                .foregroundColor(WarmInstrument.inkMuted)
                .fixedSize()
            Text(zoneTimeString(secs))
                .font(WarmInstrument.monoLabel(9))
                .foregroundColor(WarmInstrument.ink)
                .fixedSize()
        }
    }

    private func zoneTimeString(_ seconds: Double) -> String {
        let s = Int(seconds)
        if s >= 3600 { let h = s / 3600, m = (s % 3600) / 60; return m > 0 ? "\(h)h\(m)m" : "\(h)h" }
        return "\(s / 60)m"
    }

    // MARK: - Beat 03: VS Your Usual

    @ViewBuilder
    private var usualCard: some View {
        let rows = usualRows
        if !rows.isEmpty {
            WarmCard {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        MonoLabel("VS YOUR USUAL")
                        Spacer()
                        MonoLabel("TICK = USUAL", size: 9, color: WarmInstrument.inkFaint)
                    }
                    VStack(spacing: 13) {
                        ForEach(rows.indices, id: \.self) { i in
                            UsualComparisonRow(row: rows[i])
                        }
                    }
                }
            }
            .staggerReveal(delay: 0.15)
        }
    }

    private var usualRows: [UsualRow] {
        let allEntries = SyncCache.load()
        let prior = Array(
            allEntries
                .filter { $0.sportType == entry.sportType && $0.fileName != entry.fileName }
                .sorted { $0.startDateLocal > $1.startDateLocal }
                .prefix(10)
        )
        var rows: [UsualRow] = []

        // Duration — always present; requires ≥2 prior sessions
        let durations = prior.map { Double($0.elapsedTime) }
        if durations.count >= 2 {
            let usual = median(durations)
            let current = Double(entry.elapsedTime)
            let pct = ((current - usual) / usual * 100).rounded()
            let sign = pct >= 0 ? "+" : ""
            let all = durations + [current]
            rows.append(UsualRow(
                label: "Duration",
                currentValue: current,
                usualValue: usual,
                minVal: 0,
                maxVal: (all.max() ?? current) * 1.2,
                deltaLabel: "\(sign)\(Int(pct))%"
            ))
        }

        // Avg HR — present once stats have been backfilled
        let hrVals = prior.compactMap { $0.averageHeartrate }
        if hrVals.count >= 2, let currentHR = activity?.averageHeartrate {
            let usual = median(hrVals)
            let diff = currentHR - usual
            let sign = diff >= 0 ? "+" : ""
            let all = hrVals + [currentHR]
            rows.append(UsualRow(
                label: "Avg HR",
                currentValue: currentHR,
                usualValue: usual,
                minVal: (all.min() ?? currentHR) * 0.92,
                maxVal: (all.max() ?? currentHR) * 1.08,
                deltaLabel: "\(sign)\(Int(diff.rounded())) bpm"
            ))
        }

        // Above threshold (Zone 4 + Zone 5) — needs full Activity cached
        let aboveVals: [Double] = prior.compactMap { e in
            guard let z = e.activity?.hrZones else { return nil }
            return (z["Zone 4"]?.seconds ?? 0) + (z["Zone 5"]?.seconds ?? 0)
        }
        if aboveVals.count >= 2 {
            let currentZ = activity?.hrZones
            let currentAbove = (currentZ?["Zone 4"]?.seconds ?? 0) + (currentZ?["Zone 5"]?.seconds ?? 0)
            let usual = median(aboveVals)
            if usual > 30 {
                let pct = ((currentAbove - usual) / usual * 100).rounded()
                let sign = pct >= 0 ? "+" : ""
                let all = aboveVals + [currentAbove]
                rows.append(UsualRow(
                    label: "Above threshold",
                    currentValue: currentAbove,
                    usualValue: usual,
                    minVal: 0,
                    maxVal: (all.max() ?? currentAbove) * 1.2,
                    deltaLabel: "\(sign)\(Int(pct))%"
                ))
            }
        }

        return rows
    }

    private func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        let n = sorted.count
        guard n > 0 else { return 0 }
        return n % 2 == 0 ? (sorted[n/2 - 1] + sorted[n/2]) / 2 : sorted[n/2]
    }

    // MARK: - Beat 04: Score section (Badminton only)

    @ViewBuilder
    private var scoreSection: some View {
        if let desc = savedDescription {
            if let matchData = FormattedMatchData.parse(desc) {
                richScoreCard(matchData)
            } else {
                // Raw fallback — shouldn't normally happen for valid saved descriptions
                rawScoreCard(desc)
            }
        } else {
            emptyScorePrompt
        }
    }

    private func richScoreCard(_ match: FormattedMatchData) -> some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 0) {
                // Header row
                HStack {
                    MonoLabel("MATCH SCORES")
                    Spacer()
                    Button { openScoreSheet() } label: {
                        MonoLabel("EDIT", size: 9.5, color: WarmInstrument.accent)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 11)

                // Summary: big W–L + stats + result pips
                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text("\(match.wins)–\(match.losses)")
                        .font(.system(size: 30, weight: .semibold))
                        .kerning(-1.2)
                        .foregroundColor(Theme.ink)

                    MonoLabel("\(match.winPct)%", size: 10, color: WarmInstrument.inkFaint)
                        .lineLimit(1)

                    Spacer(minLength: 4)

                    HStack(spacing: 3) {
                        ForEach(match.games.prefix(15).indices, id: \.self) { i in
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(match.games[i].result == "W" ? matchWinColor : matchLossColor)
                                .frame(width: 9, height: 9)
                        }
                    }
                }
                .padding(.bottom, 12)

                // Game rows
                ForEach(match.games.indices, id: \.self) { i in
                    let game = match.games[i]
                    VStack(spacing: 0) {
                        Divider().overlay(WarmInstrument.headerRule)
                        HStack(spacing: 9) {
                            Text(game.result)
                                .font(WarmInstrument.figures(9.5, weight: .bold))
                                .foregroundColor(game.result == "W" ? matchWinColor : matchLossColor)
                                .frame(width: 10, alignment: .leading)

                            Text(game.score)
                                .font(WarmInstrument.figures(12.5, weight: .bold))
                                .foregroundColor(WarmInstrument.ink)
                                .frame(width: 44, alignment: .leading)

                            Text(game.players)
                                .font(.system(size: 12.5))
                                .foregroundColor(WarmInstrument.inkMuted)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            let marginStr = game.margin >= 0 ? "+\(game.margin)" : "\(game.margin)"
                            Text(marginStr)
                                .font(WarmInstrument.figures(11))
                                .foregroundColor(WarmInstrument.inkFaint)
                        }
                        .padding(.vertical, 7)
                    }
                }
            }
        }
        .staggerReveal(delay: 0.20)
    }

    private func rawScoreCard(_ desc: String) -> some View {
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
        .staggerReveal(delay: 0.20)
    }

    private var emptyScorePrompt: some View {
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
        .staggerReveal(delay: 0.20)
    }

    private func openScoreSheet() {
        Haptics.tap()
        descriptionText = savedDescription ?? ""
        errorMessage = nil
        showingScoreSheet = true
    }

    // MARK: - Category chip

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

    // MARK: - Formatters

    private var heroDateString: String {
        guard let start = Self.isoParser.date(from: entry.startDateLocal) else {
            return entry.startDateLocal.prefix(10).description
        }
        let end = start.addingTimeInterval(TimeInterval(entry.elapsedTime))
        let day   = Self.heroDateFormatter.string(from: start).uppercased()
        let startT = Self.heroTimeFormatter.string(from: start)
        let endT   = Self.heroTimeFormatter.string(from: end)
        return "\(day) · \(startT)–\(endT)"
    }

    private static let isoParser: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"; f.timeZone = .current; return f
    }()

    private static let heroDateFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "EEE d MMM"; return f
    }()

    private static let heroTimeFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "H:mm"; return f
    }()

    private var durationString: String {
        let h = entry.elapsedTime / 3600
        let m = (entry.elapsedTime % 3600) / 60
        return String(format: "%dh%02d", h, m)
    }

    // MARK: - Data loading

    private func loadExistingActivity() async {
        if let cached = entry.activity {
            activity = cached
            await loadHRStream(for: cached)
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let fetched = try await readActivityWithPropagationRetry()
            activity = fetched
            SyncCache.updateStats(fileName: entry.fileName, activity: fetched)
            await loadHRStream(for: fetched)
        } catch {
            errorMessage = UserFacingError.friendlyMessage(for: error)
        }
    }

    /// Fetches the HR stream sidecar on demand (ADR 0027) — it is deliberately not part of the
    /// activity record, so opening this screen is the only thing that pays for it.
    ///
    /// A missing sidecar is the normal case, not an error: every activity synced before the
    /// stream format existed has none, and one will only appear for those after a backfill.
    /// Failures are swallowed on purpose — the screen still has zones to show.
    private func loadHRStream(for activity: Activity) async {
        guard let uuid = activity.activityId, hrStream == nil else { return }
        do {
            let data = try await apiClient.readFile(path: "user_data/activities/streams/\(uuid).json")
            hrStream = try JSONDecoder().decode(HRStreamFile.self, from: data)
        } catch {
            hrStream = nil
        }
    }

    private func readActivityWithPropagationRetry() async throws -> Activity {
        try await withPropagationRetry(operation: "Reading \(entry.fileName)") {
            try await apiClient.readActivity(fileName: entry.fileName)
        }
    }

    private func readMatchHistoryForSave() async throws -> MatchHistory {
        do {
            return try await withPropagationRetry(operation: "Reading match history") {
                try await apiClient.readMatchHistory()
            }
        } catch GitHubAPIError.notFound {
            return MatchHistory(version: 1, sessions: [])
        }
    }

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

            try await apiClient.commitFiles(
                [
                    (path: "user_data/activities/hist/\(entry.fileName)", data: try encoder.encode(updatedActivity)),
                    (path: "user_data/activities/match_history.json", data: try encoder.encode(updatedHistory)),
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

    private var badge: (label: String, color: Color) { Theme.sportBadge(for: entry.sportType) }
    private var parsed: ParsedDescription? { DescriptionParser.parseRawDescription(descriptionText) }

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
                .overlay { if isSaving { ProgressView().tint(WarmInstrument.paper) } }
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
        // Resolve to FormattedMatchData regardless of whether the text is raw or already-saved
        let matchData: FormattedMatchData? = {
            if let p = parsed {
                return FormattedMatchData.parse(DescriptionParser.formatDescription(p))
            }
            return FormattedMatchData.parse(descriptionText)
        }()

        VStack(alignment: .leading, spacing: 6) {
            MonoLabel("Preview")
            WarmCard(fill: WarmInstrument.surfaceMuted) {
                if let match = matchData {
                    miniMatchPreview(match, warnings: parsed?.warnings ?? [])
                } else if descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Paste scores above. Example format:")
                            .font(.system(size: 13))
                            .foregroundColor(WarmInstrument.inkFaint)
                        Text("Partner me vs Opp1 / Opp2  21–18\nme vs Opponent  18–21")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                } else {
                    Text("No games recognized yet — keep typing or check the format.")
                        .font(.system(size: 13))
                        .foregroundColor(WarmInstrument.inkFaint)
                        .italic()
                }
            }
        }
    }

    private func miniMatchPreview(_ match: FormattedMatchData, warnings: [String]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            // Summary row — mirrors detail card but scaled down
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text("\(match.wins)–\(match.losses)")
                    .font(.system(size: 26, weight: .semibold))
                    .kerning(-1.0)
                    .foregroundColor(Theme.ink)
                MonoLabel("\(match.winPct)%", size: 9.5, color: WarmInstrument.inkFaint)
                Spacer(minLength: 4)
                HStack(spacing: 3) {
                    ForEach(match.games.prefix(15).indices, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(match.games[i].result == "W" ? matchWinColor : matchLossColor)
                            .frame(width: 8, height: 8)
                    }
                }
            }

            // Per-game rows
            ForEach(match.games.indices, id: \.self) { i in
                let game = match.games[i]
                VStack(spacing: 0) {
                    Divider().overlay(WarmInstrument.headerRule)
                    HStack(spacing: 8) {
                        Text(game.result)
                            .font(WarmInstrument.figures(9, weight: .bold))
                            .foregroundColor(game.result == "W" ? matchWinColor : matchLossColor)
                            .frame(width: 9, alignment: .leading)
                        Text(game.score)
                            .font(WarmInstrument.figures(12, weight: .bold))
                            .foregroundColor(WarmInstrument.ink)
                            .frame(width: 40, alignment: .leading)
                        Text(game.players)
                            .font(.system(size: 12))
                            .foregroundColor(WarmInstrument.inkMuted)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        let s = game.margin >= 0 ? "+\(game.margin)" : "\(game.margin)"
                        Text(s)
                            .font(WarmInstrument.figures(10))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                    .padding(.vertical, 6)
                }
            }

            // Warnings from parser
            ForEach(warnings, id: \.self) { w in
                Label(w, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundColor(Theme.attentionOrange)
            }
        }
    }
}

// MARK: - Formatted match description parser

/// Parsed representation of a stored (already-formatted) match description.
private struct FormattedMatchData {
    struct Game {
        let result: String  // "W" or "L"
        let score: String   // "21-19"
        let players: String // "Jon vs Joe + Frankie" (w/ prefix stripped)
        let margin: Int     // signed: our score − their score
    }

    let wins: Int
    let losses: Int
    let winPct: Int
    let avgMargin: Int
    let games: [Game]

    /// Parses the already-formatted description text that `DescriptionParser.formatDescription` produces.
    /// Returns nil if the text doesn't contain recognisable structured game data.
    static func parse(_ desc: String) -> FormattedMatchData? {
        guard desc.contains("Games:") || desc.contains("Friendlies:") else { return nil }

        var wins = 0, losses = 0, winPct = 0
        var games: [Game] = []
        var margins: [Int] = []
        var inGames = false

        for rawLine in desc.components(separatedBy: "\n") {
            let t = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.isEmpty else { continue }

            // Summary: "6W-1L (86%)" — appears before any "Games:" line
            if !inGames, t.contains("W-"), t.contains("L"), t.contains("(") {
                let beforePipe = t.components(separatedBy: "|").first ?? t
                let wPart = beforePipe.components(separatedBy: "W-").first ?? ""
                let afterW  = beforePipe.components(separatedBy: "W-").dropFirst().first ?? ""
                let lPart   = afterW.components(separatedBy: "L").first ?? ""
                let pctPart = beforePipe.components(separatedBy: "(").dropFirst().first?
                    .components(separatedBy: ")").first ?? ""
                wins   = Int(wPart.trimmingCharacters(in: .whitespaces)) ?? 0
                losses = Int(lPart.trimmingCharacters(in: .whitespaces)) ?? 0
                winPct = Int(pctPart.trimmingCharacters(in: .init(charactersIn: " %"))) ?? 0
                continue
            }

            if t == "Games:" || t == "Friendlies:" { inGames = true; continue }

            guard inGames, t.hasPrefix("W ") || t.hasPrefix("L ") else { continue }

            let result = String(t.prefix(1))
            let rest   = String(t.dropFirst(2))
            let parts  = rest.components(separatedBy: " ")
            guard let scoreStr = parts.first, scoreStr.contains("-") else { continue }
            let scoreParts = scoreStr.components(separatedBy: "-")
            guard let a = Int(scoreParts.first ?? ""), let b = Int(scoreParts.last ?? "") else { continue }

            let rawPlayers = parts.dropFirst().joined(separator: " ")
            // Strip "w/ " prefix from doubles lines, then capitalize names (keep connectors lowercase)
            let stripped = rawPlayers.hasPrefix("w/ ") ? String(rawPlayers.dropFirst(3)) : rawPlayers
            let connectors: Set<String> = ["vs", "+", "w/", "&", "and"]
            let players = stripped.split(separator: " ").map { word -> String in
                let w = String(word)
                return connectors.contains(w.lowercased()) ? w.lowercased() : w.prefix(1).uppercased() + w.dropFirst()
            }.joined(separator: " ")
            let margin = a - b
            margins.append(margin)
            games.append(Game(result: result, score: scoreStr, players: players, margin: margin))
        }

        guard !games.isEmpty else { return nil }

        let avgMargin = margins.isEmpty ? 0 : Int((Double(margins.reduce(0, +)) / Double(margins.count)).rounded())
        return FormattedMatchData(wins: wins, losses: losses, winPct: winPct, avgMargin: avgMargin, games: games)
    }
}

// MARK: - VS Your Usual row model + view

private struct UsualRow {
    let label: String
    let currentValue: Double
    let usualValue: Double
    let minVal: Double
    let maxVal: Double
    let deltaLabel: String
}

private struct UsualComparisonRow: View {
    let row: UsualRow
    @State private var filled = false

    var body: some View {
        HStack(spacing: 12) {
            Text(row.label)
                .font(.system(size: 12.5))
                .foregroundColor(WarmInstrument.inkMuted)
                .frame(width: 104, alignment: .leading)

            GeometryReader { geo in
                let w = geo.size.width
                let range = row.maxVal - row.minVal
                let currentFrac = range > 0 ? CGFloat((row.currentValue - row.minVal) / range) : 0
                let usualFrac   = range > 0 ? CGFloat((row.usualValue  - row.minVal) / range) : 0

                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                        .fill(Color(red: 84/255, green: 76/255, blue: 65/255).opacity(0.13))
                        .frame(height: 5)

                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                        .fill(WarmInstrument.accent)
                        .frame(width: max(4, w * min(1, filled ? currentFrac : 0)), height: 5)
                        .animation(.spring(duration: 0.55, bounce: 0.08), value: filled)

                    Capsule()
                        .fill(WarmInstrument.ink.opacity(0.45))
                        .frame(width: 1.5, height: 13)
                        .offset(x: w * min(1, max(0, usualFrac)) - 0.75)
                }
                .frame(height: 13, alignment: .center)
            }
            .frame(height: 13)

            Text(row.deltaLabel)
                .font(WarmInstrument.figures(12, weight: .bold))
                .foregroundColor(WarmInstrument.ink)
                .frame(width: 60, alignment: .trailing)
        }
        .onAppear {
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(0.1))
                filled = true
            }
        }
    }
}

// MARK: - Supporting stat cell

private struct SupportingStatCell: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(WarmInstrument.figures(17, weight: .bold))
                .foregroundColor(Theme.ink)
                .contentTransition(.numericText())
            MonoLabel(label, size: 8.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
