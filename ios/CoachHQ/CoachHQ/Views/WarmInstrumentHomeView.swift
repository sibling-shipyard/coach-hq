import Foundation
import SwiftUI
import UniformTypeIdentifiers

/// Warm Instrument Home — mobile-first scrolling column fed by the hosted dashboard API
/// (`GET /api/widget-snapshots`, ADR 0005). Layout matches `Warm Instrument Mobile.dc.html`:
/// compact header, engine → commitments strip → plan → calories/quest pair → build phase → recent.
/// Engine detail opens via push navigation. See `ui/docs/reference-interactions/Widget Design Philosophy.md`
/// (platform row "iOS app (Home)").
enum HomeRoute: Hashable {
    case engine
    case activities
    case activity(SyncCacheEntry)
}

struct WarmInstrumentHomeView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var store: WidgetSnapshotStore
    @EnvironmentObject var syncManager: HealthKitSyncManager

    @State private var toast: Toast?
    @State private var isEditingLayout = false
    @State private var navigationPath: [HomeRoute] = []
    @State private var badmintonShowsRanked = false

    @AppStorage("engineOverlayDismissed") private var engineOverlayDismissed = false
    @State private var enginePulse: Bool = false

    @AppStorage("wiEngineSize") private var engineSize = "M"
    @AppStorage("wiQuestSize") private var questSize = "M"
    @AppStorage("wiCommitmentsSize") private var commitmentsSize = "M"

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(spacing: 14) {
                    if let snapshots = store.snapshots {
                        CompactInstrumentHeader(phase: snapshots.home.phase)

                        if !snapshots.home.sync.healthy {
                            SyncWarningBanner(sync: snapshots.home.sync)
                        }

                        widgetColumn(for: snapshots)
                            .transition(.opacity)
                    } else if !authManager.isSessionReady || !store.isConfigured || store.isLoading {
                        HomeSkeletonView()
                    } else if authManager.selectedRepo == nil {
                        repoNotConfiguredState
                    } else {
                        emptyState
                    }
                }
                .frame(maxWidth: .infinity, alignment: .top)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .animation(PremiumMotion.statsLoad, value: store.snapshots != nil)
            }
            .mainTabScrollBottomClearance()
            .scrollClipDisabled()
            .scrollContentBackground(.hidden)
            .refreshable { await store.refresh(showSpinner: false) }
            .toast($toast)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: HomeRoute.self) { route in
                switch route {
                case .engine:
                    if let snapshots = store.snapshots {
                        EngineDetailView(
                            engine: snapshots.sizes.engine.M,
                            coachRead: snapshots.home.coachRead
                        )
                    }
                case .activities:
                    ActivityListView(
                        embedded: true,
                        onSelectEntry: { entry in navigationPath.append(.activity(entry)) }
                    )
                case .activity(let entry):
                    ActivityDetailView(entry: entry)
                }
            }
            .task(id: homeFetchToken) {
                guard store.isConfigured else { return }
                guard authManager.isAuthenticated, authManager.isSessionReady else { return }
                guard authManager.selectedRepo != nil else { return }
                guard store.shouldRefresh else { return }
                await store.refresh(showSpinner: store.snapshots == nil)
            }
            .onChange(of: store.lastError) { _, newError in
                guard let newError, !newError.isEmpty else { return }
                authManager.noteAPIError(newError)
                Haptics.error()
                toast = Toast(kind: .error, message: UserFacingError.friendlyAPIError(newError))
            }
            .onChange(of: syncManager.lastSyncResult) { _, result in
                guard let result, case .synced(let n) = result.outcome, n > 0 else { return }
                toast = Toast(kind: .success, message: syncToastMessage(n: n))
                enginePulse = true
                Task { try? await Task.sleep(for: .seconds(0.55)); enginePulse = false }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                guard store.isConfigured else { return }
                Task { await store.refresh(showSpinner: false) }
            }
            .overlay(alignment: .topTrailing) {
                if isEditingLayout {
                    doneButton
                        .padding(.top, 14)
                        .padding(.trailing, 16)
                }
            }
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
    }

    // MARK: - Widget column

    @ViewBuilder
    private func widgetColumn(for snapshots: WidgetSnapshotsFile) -> some View {
        let home = snapshots.home

        // Engine — tap opens dose ledger + coach read
        EditableWidget(isEditing: $isEditingLayout, sizeBinding: $engineSize, sizeOptions: ["S", "M", "L"], jigglePhase: 0.00) {
            Button {
                Haptics.tap()
                navigationPath.append(.engine)
            } label: {
                EngineWidget(size: WidgetSize(rawValue: engineSize) ?? .m, sizes: snapshots.sizes.engine)
            }
            .buttonStyle(.plain)
        }
        .scaleEffect(enginePulse ? 1.02 : 1)
        .animation(.spring(duration: 0.45, bounce: 0.35), value: enginePulse)
        .staggerReveal(delay: 0.30)
        .overlay {
            if !engineOverlayDismissed {
                EngineFirstVisitOverlay {
                    withAnimation(.easeOut(duration: 0.25)) { engineOverlayDismissed = true }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.25), value: engineOverlayDismissed)

        // Sport commitment quartet strip
        EditableWidget(isEditing: $isEditingLayout, sizeBinding: $commitmentsSize, sizeOptions: ["S", "M"], jigglePhase: 0.05) {
            CommitmentStripWidget(
                size: WidgetSize(rawValue: commitmentsSize) ?? .m,
                sizes: snapshots.sizes.commitments,
                showingRanked: $badmintonShowsRanked
            )
        }
        .staggerReveal(delay: 0.40)

        // Weekly plan — chip drag owns long-press; not wrapped in jiggle editor.
        WeeklyPlanWidget(plan: home.plan, compact: true)
            .staggerReveal(delay: 0.50)

        // Calories + main quest side-by-side
        HStack(spacing: 14) {
            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.15) {
                CaloriesWidget(calories: home.calories, compact: true)
            }
            EditableWidget(isEditing: $isEditingLayout, sizeBinding: $questSize, sizeOptions: ["S", "M"], jigglePhase: 0.20) {
                QuestWidget(size: WidgetSize(rawValue: questSize) ?? .m, home: home.quest, small: snapshots.sizes.quest.S, compact: true)
            }
        }
        .staggerReveal(delay: 0.60)

        EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.25) {
            BuildPhaseWidget(phase: home.phase)
        }
        .staggerReveal(delay: 0.70)

        EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.30) {
            RecentSessionsWidget(
                sessions: home.sessions,
                compact: true,
                onOpenActivities: { navigationPath.append(.activities) },
                onOpen: { entry in
                    Haptics.tap()
                    navigationPath.append(.activity(entry))
                },
                onUnavailable: {
                    toast = Toast(kind: .info, message: "Sync this session to open it.")
                }
            )
        }
        .staggerReveal(delay: 0.80)
    }

    // MARK: - Header / states

    private func syncToastMessage(n: Int) -> String {
        let rounds = syncManager.lastRoundSynced
        if rounds.count == 1, let (sportType, _) = rounds.first {
            let label = Theme.sportBadge(for: sportType).label.capitalized
            return "\(label) session synced — Coach is on it"
        }
        let word = n == 1 ? "session" : "sessions"
        return "\(n) \(word) synced — Coach is on it"
    }

    /// Re-triggers the Home fetch once GitHub profile + repo discovery finish.
    private var homeFetchToken: String {
        [
            store.isConfigured ? "configured" : "pending",
            authManager.isSessionReady ? "ready" : "boot",
            authManager.user?.login ?? "",
            authManager.repoFullName ?? "",
        ].joined(separator: "|")
    }

    private var doneButton: some View {
        Button {
            Haptics.tap()
            withAnimation(.spring(duration: 0.3)) { isEditingLayout = false }
        } label: {
            Text("Done")
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(WarmInstrument.accent)
        }
    }

    private var repoNotConfiguredState: some View {
        VStack(spacing: 12) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 36))
                .foregroundColor(WarmInstrument.accent)
            Text("Coach repo not found")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
            Text("Signed in as \(authManager.user?.login ?? "GitHub"), but no `coach-*` repo was discovered. Check Settings for the linked repo.")
                .font(.system(size: 12))
                .foregroundColor(WarmInstrument.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 100)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "gauge.with.dots.needle.33percent")
                .font(.system(size: 36))
                .foregroundColor(WarmInstrument.accent)
            Text("Home isn't synced yet")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
            Text("Pull down to fetch this week's snapshot.")
                .font(.system(size: 12))
                .foregroundColor(WarmInstrument.inkMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 100)
    }
}

// MARK: - Engine first-visit overlay

private struct EngineFirstVisitOverlay: View {
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                .fill(WarmInstrument.ink.opacity(0.88))
            VStack(spacing: 10) {
                Text("This is your weekly load")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                Text("Coach uses your training dose score to calibrate what's next. Tap the Engine any time for the full breakdown.")
                    .font(WarmInstrument.coachVoice(13))
                    .foregroundColor(.white.opacity(0.88))
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                Text("TAP TO DISMISS")
                    .font(WarmInstrument.monoLabel(9))
                    .tracking(0.8)
                    .foregroundColor(.white.opacity(0.45))
            }
            .padding(20)
        }
        .onTapGesture {
            Haptics.tap()
            onDismiss()
        }
        .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))
    }
}

// MARK: - Sync warning banner

/// The one "something's wrong" treatment (Design Philosophy's alarm color) applied to the
/// whole Home surface when the last sync round wasn't healthy — never stacked with other
/// alarms, shown once at the top of the column.
private struct SyncWarningBanner: View {
    let sync: WidgetSyncSnapshot

    var body: some View {
        WarmCard(padding: 12, fill: WarmInstrument.alarmBg) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(WarmInstrument.alarmFg)

                VStack(alignment: .leading, spacing: 4) {
                    Text(sync.label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(WarmInstrument.alarmFg)
                    ForEach(sync.warnings, id: \.self) { warning in
                        Text(warning)
                            .font(.system(size: 11))
                            .foregroundColor(WarmInstrument.alarmFg.opacity(0.85))
                    }
                }

                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Widget size

enum WidgetSize: String {
    case s = "S", m = "M", l = "L"
}

// MARK: - Editable widget wrapper (long-press jiggle + S/M/L picker)

/// Wraps a widget with the "iOS app (Home)" interaction budget: long-press (~550ms) enters
/// edit mode for the whole column (jiggle, ±1.4°), and — where the snapshot has size
/// variants — a small S/M/L picker appears on the widget. Swaps content in place; widgets
/// never reflow mid-edit (only the picked size changes, not position).
private struct EditableWidget<Content: View>: View {
    @Binding var isEditing: Bool
    var sizeBinding: Binding<String>? = nil
    var sizeOptions: [String] = []
    var jigglePhase: Double = 0
    @ViewBuilder var content: Content

    var body: some View {
        content
            .jiggling(isEditing, phase: jigglePhase)
            .overlay(alignment: .topTrailing) {
                if isEditing, let sizeBinding, !sizeOptions.isEmpty {
                    SizePickerBadge(size: sizeBinding, options: sizeOptions)
                        .offset(x: -10, y: -10)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .onLongPressGesture(minimumDuration: 0.55) {
                guard !isEditing else { return }
                Haptics.tap()
                withAnimation(.spring(duration: 0.3)) { isEditing = true }
            }
    }
}

private struct JiggleModifier: ViewModifier {
    let isActive: Bool
    let phase: Double
    @State private var animate = false

    func body(content: Content) -> some View {
        content
            .rotationEffect(.degrees(isActive ? (animate ? 1.4 : -1.4) : 0))
            .animation(
                isActive
                    ? .easeInOut(duration: 0.15).repeatForever(autoreverses: true).delay(phase)
                    : .default,
                value: animate
            )
            .onChange(of: isActive) { _, active in animate = active }
            .onAppear { if isActive { animate = true } }
    }
}

private extension View {
    func jiggling(_ isActive: Bool, phase: Double = 0) -> some View {
        modifier(JiggleModifier(isActive: isActive, phase: phase))
    }
}

private struct SizePickerBadge: View {
    @Binding var size: String
    let options: [String]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { option in
                Button {
                    guard size != option else { return }
                    Haptics.tap()
                    withAnimation(.spring(duration: 0.25)) { size = option }
                } label: {
                    Text(option)
                        .font(.system(size: 10, weight: .bold, design: .monospaced))
                        .frame(width: 22, height: 22)
                        .foregroundColor(size == option ? .white : WarmInstrument.inkMuted)
                        .background(size == option ? WarmInstrument.accent : Color.clear)
                        .clipShape(Circle())
                }
            }
        }
        .padding(3)
        .background(WarmInstrument.paper)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(WarmInstrument.border, lineWidth: 1))
        .shadow(color: WarmInstrument.cardShadow, radius: 6, x: 0, y: 3)
    }
}

// MARK: - Swipe → Edit row (sessions only; delete lives in session detail, not Home)

private struct SwipeToEditRow<Content: View>: View {
    let onEdit: () -> Void
    @ViewBuilder var content: Content

    @State private var offset: CGFloat = 0
    @GestureState private var dragTranslation: CGFloat = 0

    private let actionWidth: CGFloat = 72
    private let gap: CGFloat = 14

    var body: some View {
        ZStack(alignment: .trailing) {
            Button {
                Haptics.tap()
                withAnimation(.spring(duration: 0.3)) { offset = 0 }
                onEdit()
            } label: {
                Text("EDIT")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .tracking(0.8)
                    .foregroundColor(.white)
                    .frame(width: actionWidth, height: 44)
                    .background(Color(red: 0xc4 / 255, green: 0x8a / 255, blue: 0x2e / 255))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .opacity(offset < -20 ? 1 : 0)

            content
                .background(WarmInstrument.paper)
                .offset(x: offset + dragTranslation)
                .gesture(
                    DragGesture(minimumDistance: 12)
                        .updating($dragTranslation) { value, state, _ in
                            guard value.translation.width < 0 else { return }
                            state = max(value.translation.width, -(actionWidth + gap))
                        }
                        .onEnded { value in
                            let projected = offset + value.translation.width
                            withAnimation(.spring(duration: 0.3)) {
                                offset = projected < -(actionWidth / 2) ? -(actionWidth + gap) : 0
                            }
                        }
                )
        }
    }
}

// MARK: - P0: Engine

private struct EngineWidget: View {
    let size: WidgetSize
    let sizes: EngineSizes

    @State private var bandProgress: Double = 0

    var body: some View {
        WarmCard(padding: size == .m ? 20 : 18, fill: WarmInstrument.accent) {
            VStack(alignment: .leading, spacing: 14) {
                switch size {
                case .s:
                    header(weekLabel: sizes.S.weekLabel, signal: sizes.S.signal)
                    readout(load: sizes.S.load * bandProgress, verdict: sizes.S.compactVerdict)
                    bandStrip(load: sizes.S.load, bandLow: sizes.S.bandLow, bandHigh: sizes.S.bandHigh)
                case .m:
                    mobileHeader(weekLabel: sizes.M.weekLabel, signal: sizes.M.signal)
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(numberString(sizes.M.load * bandProgress))
                                .font(.system(size: 46, weight: .medium, design: .default))
                                .tracking(-2)
                                .foregroundColor(.white)
                                .contentTransition(.numericText())
                            Text(sizes.M.compactVerdict ?? sizes.M.verdict)
                                .font(WarmInstrument.coachVoice(16))
                                .foregroundColor(.white.opacity(0.9))
                        }
                        .frame(width: 118, alignment: .leading)

                        mobileTrendSparkline(sizes.M.trend, bandLow: sizes.M.bandLow, bandHigh: sizes.M.bandHigh)
                            .drawingGroup()
                            .frame(maxWidth: .infinity)
                    }
                    .padding(.top, 2)

                    mixBar(sizes.M.mix, totalHours: sizes.M.totalHours)
                        .padding(.top, 14)
                        .overlay(alignment: .top) {
                            Rectangle()
                                .fill(Color.white.opacity(0.16))
                                .frame(height: 1)
                                .padding(.top, -12)
                        }
                case .l:
                    header(weekLabel: sizes.L.weekLabel, signal: sizes.L.signal)
                    readout(load: sizes.L.load * bandProgress, verdict: sizes.L.verdict)
                    bandStrip(load: sizes.L.load, bandLow: sizes.L.bandLow, bandHigh: sizes.L.bandHigh)
                    trendSparkline(sizes.L.trend)
                    mixBar(sizes.L.mix, totalHours: sizes.L.totalHours)
                    Text(sizes.L.method)
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundColor(.white.opacity(0.65))
                }
            }
        }
        .shadow(color: WarmInstrument.engineShadow, radius: size == .m ? 24 : 20, x: 0, y: size == .m ? 12 : 10)
        .onChange(of: sizes.M.load) { _, _ in
            // Don't reset — only animate to 1.0 if the initial task hasn't finished yet.
            // Resetting on every foreground refresh caused a jarring count-from-zero on each return.
            withAnimation(.spring(duration: 0.7, bounce: 0.1).delay(0.05)) { bandProgress = 1.0 }
        }
        .task {
            try? await Task.sleep(for: .seconds(0.30))
            withAnimation(.spring(duration: 0.7, bounce: 0.1)) { bandProgress = 1.0 }
        }
    }

    private func header(weekLabel: String, signal: String) -> some View {
        HStack {
            Text("ENGINE · \(weekLabel)")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.1)
                .foregroundColor(.white.opacity(0.75))
            Spacer()
            Text(signal)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.1)
                .foregroundColor(.white)
        }
    }

    private func mobileHeader(weekLabel: String, signal: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("ENGINE")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.3)
                .foregroundColor(.white.opacity(0.65))
            Spacer()
            Text(weekLabel.uppercased())
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(1.3)
                .foregroundColor(.white.opacity(0.45))
        }
    }

    private func readout(load: Double, verdict: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(numberString(load))
                .font(.system(size: 44, weight: .heavy, design: .monospaced))
                .foregroundColor(.white)
                .contentTransition(.numericText())
            Text(verdict)
                .font(.system(size: 15, design: .serif).italic())
                .foregroundColor(.white.opacity(0.85))
        }
    }

    private func bandStrip(load: Double, bandLow: Double?, bandHigh: Double?) -> some View {
        GeometryReader { geo in
            let low = bandLow ?? load * 0.8
            let high = max(bandHigh ?? load * 1.2, low + 1)
            let scaleLow = min(low, load) * 0.85
            let scaleHigh = max(high, load) * 1.15 + 1
            let range = max(1, scaleHigh - scaleLow)
            let xLow = CGFloat((low - scaleLow) / range) * geo.size.width
            let xHigh = CGFloat((high - scaleLow) / range) * geo.size.width
            let xLoad = CGFloat((load - scaleLow) / range) * geo.size.width

            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.18)).frame(height: 6)
                Capsule()
                    .fill(Color.white.opacity(0.55))
                    .frame(width: max(1, xHigh - xLow) * bandProgress, height: 10)
                    .offset(x: xLow * bandProgress)
                Circle()
                    .fill(Color.white)
                    .frame(width: 10, height: 10)
                    .offset(x: max(0, xLoad * bandProgress - 5))
            }
        }
        .frame(height: 12)
    }

    private func trendSparkline(_ points: [TrendPointSnapshot]) -> some View {
        let values = points.map(\.value)
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(1, maxV - minV)
        return GeometryReader { geo in
            Path { path in
                for (index, point) in points.enumerated() {
                    let x = points.count > 1
                        ? geo.size.width * CGFloat(index) / CGFloat(points.count - 1)
                        : geo.size.width
                    let y = geo.size.height - geo.size.height * CGFloat((point.value - minV) / range)
                    if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
        .frame(height: 40)
    }

    private func mobileTrendSparkline(_ points: [TrendPointSnapshot], bandLow: Double?, bandHigh: Double?) -> some View {
        let values = points.map(\.value)
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(1, maxV - minV)
        let lowLabel = bandLow.map { "\(Int($0))–\(Int(bandHigh ?? $0)) USUAL" } ?? ""
        let firstLabel = points.first?.label.uppercased() ?? "6 WK"

        return GeometryReader { geo in
            let chartTop: CGFloat = 18
            let chartHeight: CGFloat = 34
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.white.opacity(0.09))
                    .frame(height: chartHeight)
                    .offset(y: chartTop)

                Path { path in
                    for (index, point) in points.enumerated() {
                        let x = points.count > 1
                            ? geo.size.width * CGFloat(index) / CGFloat(points.count - 1)
                            : geo.size.width
                        let normalized = (point.value - minV) / range
                        let y = chartTop + chartHeight - chartHeight * 0.65 * normalized - chartHeight * 0.15
                        if index == 0 { path.move(to: CGPoint(x: x, y: y)) }
                        else { path.addLine(to: CGPoint(x: x, y: y)) }
                    }
                }
                .stroke(Color.white.opacity(0.9), style: StrokeStyle(lineWidth: 2.2, lineCap: .round, lineJoin: .round))

                if let last = points.last {
                    let x = points.count > 1
                        ? geo.size.width * CGFloat(points.count - 1) / CGFloat(points.count - 1)
                        : geo.size.width
                    let normalized = (last.value - minV) / range
                    let y = chartTop + chartHeight - chartHeight * 0.65 * normalized - chartHeight * 0.15
                    Circle()
                        .fill(Color.white)
                        .frame(width: 8, height: 8)
                        .position(x: x, y: y)
                }

                HStack {
                    Text(firstLabel)
                    Spacer()
                    Text(lowLabel)
                }
                .font(.system(size: 8.5, weight: .regular, design: .monospaced))
                .tracking(1)
                .foregroundColor(.white.opacity(0.5))
                .offset(y: chartTop + chartHeight + 16)
            }
        }
        .frame(height: 76)
    }

    private func mixBar(_ mix: [LoadMixSnapshot], totalHours: Double) -> some View {
        let trackedHours = mix.reduce(0) { $0 + $1.hours }
        let denominator = max(totalHours, trackedHours, 1)
        let activeMix = mix.filter { $0.hours > 0 }

        return VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(activeMix) { item in
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(WarmInstrument.color(hex: item.color))
                            .frame(width: max(2, geo.size.width * CGFloat(item.hours / denominator)))
                    }
                    if trackedHours < totalHours {
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(Color.white.opacity(0.16))
                            .frame(maxWidth: .infinity)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
            .frame(height: 8)

            HStack(spacing: 14) {
                ForEach(activeMix) { item in
                    HStack(spacing: 5) {
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .fill(WarmInstrument.color(hex: item.color))
                            .frame(width: 7, height: 7)
                        Text("\(item.shortLabel.uppercased()) \(String(format: "%.1f", item.hours))H")
                            .font(.system(size: 9.5, weight: .regular, design: .monospaced))
                            .foregroundColor(.white.opacity(0.75))
                    }
                }
                Spacer(minLength: 0)
                Text(String(format: "%.1fH", totalHours))
                    .font(.system(size: 9.5, weight: .regular, design: .monospaced))
                    .foregroundColor(.white.opacity(0.45))
            }
        }
    }

    private func numberString(_ value: Double) -> String {
        value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }
}

// MARK: - P0: Sport commitment strip

private struct CommitmentStripWidget: View {
    let size: WidgetSize
    let sizes: CommitmentSizes
    @Binding var showingRanked: Bool

    var body: some View {
        if size == .s {
            WarmCard {
                SportCube(commitment: sizes.S)
            }
        } else if sizes.M.isEmpty {
            WarmCard {
                Text("No commitments configured yet.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        } else {
            WarmCard(padding: 0) {
                HStack(spacing: 0) {
                    ForEach(Array(sizes.M.enumerated()), id: \.element.id) { index, item in
                        SportStripCell(
                            commitment: item,
                            showingRanked: item.id == "badminton" ? showingRanked : false,
                            onToggle: item.id == "badminton" && item.hasRankedRecord == true
                                ? { showingRanked.toggle() }
                                : nil
                        )
                        .overlay(alignment: .trailing) {
                            if index < sizes.M.count - 1 {
                                Rectangle()
                                    .fill(WarmInstrument.border.opacity(0.7))
                                    .frame(width: 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - P0: Main & side quests

private struct QuestWidget: View {
    let size: WidgetSize
    let home: QuestSnapshot
    let small: QuestSnapshotS
    var compact: Bool = false

    private var fraction: Double {
        size == .s
            ? small.progressPercent / 100
            : (home.target > 0 ? home.completed / home.target : 0)
    }

    var body: some View {
        WarmCard(padding: compact ? 16 : 16) {
            VStack(alignment: .leading, spacing: compact ? 0 : 10) {
                MonoLabel("MAIN QUEST", size: compact ? 9 : 10)

                if compact {
                    Text(size == .s ? small.name : home.name)
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(2)
                        .padding(.top, 8)

                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(size == .s ? "\(Int(small.completed))" : questNumber(home.completed))
                            .font(WarmInstrument.figures(26, weight: .bold))
                            .foregroundColor(WarmInstrument.accent)
                        Text(size == .s ? " / \(Int(small.target))" : " / \(questNumber(home.target))")
                            .font(WarmInstrument.figures(11, weight: .semibold))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                    .padding(.top, 4)

                    Spacer(minLength: 0)

                    HairlineProgress(fraction: fraction, height: 8)
                        .padding(.top, 14)

                    HStack {
                        Text("LOADED \(questNumber(home.loaded))")
                            .font(.system(size: 8, weight: .regular, design: .monospaced))
                            .foregroundColor(WarmInstrument.inkMuted)
                        Spacer()
                        Text("\(home.daysLeft)D LEFT")
                            .font(.system(size: 8, weight: .bold, design: .monospaced))
                            .foregroundColor(WarmInstrument.accent)
                    }
                    .padding(.top, 6)
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        Text(size == .s ? small.name : home.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(WarmInstrument.ink)
                            .lineLimit(1)
                        Spacer()
                        HStack(alignment: .firstTextBaseline, spacing: 1) {
                            Text(size == .s ? "\(Int(small.completed))" : questNumber(home.completed))
                                .font(WarmInstrument.figures(18, weight: .bold))
                            Text(size == .s ? " / \(Int(small.target))" : " / \(questNumber(home.target))")
                                .font(WarmInstrument.figures(12, weight: .semibold))
                                .foregroundColor(WarmInstrument.inkFaint)
                        }
                        .foregroundColor(WarmInstrument.ink)
                        .contentTransition(.numericText())
                    }

                    HairlineProgress(fraction: fraction, height: 4)

                    if size != .s, !home.sideQuests.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            MonoLabel("SIDE QUESTS", size: 9)
                            ForEach(home.sideQuests.prefix(2), id: \.name) { side in
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack {
                                        Text(side.name)
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundColor(WarmInstrument.ink)
                                        Spacer()
                                        Text("\(Int(side.value))/\(Int(side.target))")
                                            .font(WarmInstrument.figures(11))
                                            .foregroundColor(WarmInstrument.inkMuted)
                                    }
                                    HairlineProgress(
                                        fraction: side.target > 0 ? side.value / side.target : 0,
                                        tint: WarmInstrument.color(hex: side.color),
                                        height: 3
                                    )
                                }
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: compact ? 148 : nil, alignment: .leading)
        }
    }

    private func questNumber(_ value: Double) -> String {
        value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }
}

// MARK: - P0: Recent sessions

private struct RecentSessionsWidget: View {
    let sessions: [RecentSessionSnapshot]
    var compact: Bool = false
    var onOpenActivities: (() -> Void)? = nil
    let onOpen: (SyncCacheEntry) -> Void
    let onUnavailable: () -> Void

    @State private var cacheEntries: [SyncCacheEntry] = []

    private var visible: [RecentSessionSnapshot] { Array(sessions.prefix(3)) }

    var body: some View {
        WarmCard(padding: compact ? 18 : 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    MonoLabel(compact ? "RECENT" : "RECENT SESSIONS", size: compact ? 10 : 10)
                    Spacer()
                    if compact, let onOpenActivities {
                        Button {
                            Haptics.tap()
                            onOpenActivities()
                        } label: {
                            Text("All activity")
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundColor(WarmInstrument.ink)
                        }
                    }
                }
                .padding(.bottom, compact ? 4 : 4)

                if visible.isEmpty {
                    Text("No sessions logged yet — nothing invented here.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, session in
                            if compact {
                                SessionRow(session: session, compact: true)
                            } else {
                                SwipeToEditRow(onEdit: { handleEdit(session) }) {
                                    SessionRow(session: session).padding(.horizontal, 2)
                                }
                            }
                            if index < visible.count - 1 {
                                Divider().overlay(WarmInstrument.headerRule)
                            }
                        }
                    }
                }
            }
        }
        .onAppear {
            if cacheEntries.isEmpty {
                cacheEntries = SyncCache.load()
            }
        }
    }

    private func handleEdit(_ session: RecentSessionSnapshot) {
        let cache = cacheEntries.isEmpty ? SyncCache.load() : cacheEntries
        if let source = session.evidence?.source,
           let hit = cache.first(where: { $0.fileName == source }) {
            onOpen(hit)
            return
        }
        if let dateKey = session.evidence?.dateKey,
           let hit = cache.first(where: { $0.fileName.hasPrefix(dateKey) || $0.startDateLocal.hasPrefix(dateKey) }) {
            onOpen(hit)
            return
        }
        onUnavailable()
    }
}

// MARK: - P1: Weekly plan

private struct WeeklyPlanWidget: View {
    let plan: WeeklyPlanSnapshot
    var compact: Bool = false

    /// Local-only reorder state — resets to `plan.days` on next snapshot fetch. Writing the
    /// swap back to GitHub is listed as *Proposed* (not required) in the Design Philosophy's
    /// weekly-plan interaction note; this phase mirrors the web's client-side-only reorder.
    @State private var days: [PlanDaySnapshot]
    @State private var dragIndex: Int?

    init(plan: WeeklyPlanSnapshot, compact: Bool = false) {
        self.plan = plan
        self.compact = compact
        _days = State(initialValue: plan.days)
    }

    private var projection: (label: String, isOver: Bool) {
        let known = days.compactMap(\.loadDelta)
        guard !known.isEmpty else { return ("Projection unavailable", false) }
        let total = known.reduce(0, +)
        guard let low = plan.bandLow, let high = plan.bandHigh else {
            return ("Projected ≈\(Int(total)) — band unavailable.", false)
        }
        if total > high { return ("Projected ≈\(Int(total)) — over the band. Ease off.", true) }
        if total < low { return ("Projected ≈\(Int(total)) — below the band.", false) }
        return ("Projected ≈\(Int(total)) — in the band.", false)
    }

    var body: some View {
        WarmCard(padding: compact ? 18 : 16, dashed: true) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    MonoLabel(plan.title ?? "WEEKLY PLAN", size: compact ? 10 : 10)
                    Spacer()
                    Text(plan.statusLabel ?? (plan.isPreview ? "COACH DRAFT" : plan.label))
                        .font(WarmInstrument.monoLabel(9))
                        .tracking(1.0)
                        .foregroundColor(WarmInstrument.inkMuted)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .strokeBorder(WarmInstrument.headerRule, lineWidth: 1)
                        )
                }

                HStack(spacing: compact ? 7 : 6) {
                    ForEach(Array(days.enumerated()), id: \.element.key) { index, day in
                        daySlot(day, index: index)
                    }
                }

                if !compact {
                    Text(projection.label)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(projection.isOver ? WarmInstrument.accent : WarmInstrument.inkMuted)
                }
            }
        }
        .onChange(of: plan.days.map(\.key)) { _, _ in days = plan.days }
    }

    private func daySlot(_ day: PlanDaySnapshot, index: Int) -> some View {
        VStack(spacing: 4) {
            Text(String(day.dayShort.prefix(1)))
                .font(.system(size: compact ? 8.5 : 9, weight: .bold, design: .monospaced))
                .foregroundColor(WarmInstrument.inkFaint)

            Group {
                if let glyph = day.glyph {
                    Image(systemName: WarmInstrument.sfSymbol(for: glyph))
                        .font(.system(size: compact ? 14 : 13, weight: .semibold))
                        .foregroundColor(sportTint(day))
                } else if compact {
                    Color.clear
                } else {
                    Text("REST")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: compact ? 26 : 38)
            .background(sportTint(day).opacity(day.glyph != nil ? 0.1 : 0))
            .clipShape(RoundedRectangle(cornerRadius: compact ? 5 : 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: compact ? 5 : 10, style: .continuous)
                    .strokeBorder(
                        day.glyph != nil
                            ? sportTint(day).opacity(0.35)
                            : (compact ? WarmInstrument.border.opacity(0.5) : WarmInstrument.border),
                        style: day.glyph == nil && compact ? StrokeStyle(lineWidth: 1, dash: [4, 3]) : StrokeStyle(lineWidth: 1)
                    )
            )
            .overlay(alignment: .bottom) {
                if !compact, let delta = day.loadDelta {
                    Text("+\(Int(delta))")
                        .font(.system(size: 8, weight: .semibold, design: .monospaced))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .offset(y: 14)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onDrag {
            guard days[index].glyph != nil else { return NSItemProvider() }
            dragIndex = index
            return NSItemProvider(object: String(index) as NSString)
        }
        .onDrop(of: [.text], delegate: PlanDropDelegate(index: index, days: $days, dragIndex: $dragIndex))
    }

    private func sportTint(_ day: PlanDaySnapshot) -> Color {
        guard day.glyph != nil, let sportId = WarmSportId(rawValue: day.sport) else { return WarmInstrument.inkFaint }
        return WarmInstrument.sportColor(sportId)
    }
}

private struct PlanDropDelegate: DropDelegate {
    let index: Int
    @Binding var days: [PlanDaySnapshot]
    @Binding var dragIndex: Int?

    func performDrop(info: DropInfo) -> Bool {
        defer { dragIndex = nil }
        guard let from = dragIndex, from != index, days[from].glyph != nil else { return false }
        Haptics.tap()
        days.swapAt(from, index)
        return true
    }

    func dropEntered(info: DropInfo) {}
}

// MARK: - P1: Training activity heatmap

private struct TrainingActivityWidget: View {
    let activity: TrainingActivitySnapshot

    @State private var windowStart: Int

    init(activity: TrainingActivitySnapshot) {
        self.activity = activity
        _windowStart = State(initialValue: max(0, activity.months.count - 1))
    }

    private static let legend: [(WarmSportId, String)] = [
        (.badminton, "BDM"), (.calisthenics, "CAL"), (.foundation, "FDN"), (.cycling, "RIDE"),
        (.run, "RUN"), (.strength, "STR"), (.weightTraining, "WGT"), (.hike, "HIK"),
        (.walk, "WLK"), (.cricket, "CRK"), (.football, "FBL"), (.workout, "WKT"), (.swim, "SWM"),
    ]

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 7)

    private var visibleMonth: ActivityMonthSnapshot? {
        activity.months.indices.contains(windowStart) ? activity.months[windowStart] : nil
    }

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    MonoLabel(visibleMonth.map { "ACTIVITY · \($0.label)" } ?? "ACTIVITY")
                    Spacer()
                    if !activity.months.isEmpty {
                        HStack(spacing: 4) {
                            pageButton(system: "chevron.left", enabled: windowStart > 0) { windowStart -= 1 }
                            pageButton(system: "chevron.right", enabled: windowStart < activity.months.count - 1) { windowStart += 1 }
                        }
                    }
                }

                if activity.months.isEmpty {
                    Text("No training activity logged yet.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                }

                if let month = visibleMonth {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 3) {
                            ForEach(Array("MTWTFSS".enumerated()), id: \.offset) { _, ch in
                                Text(String(ch))
                                    .font(.system(size: 8, weight: .bold, design: .monospaced))
                                    .foregroundColor(WarmInstrument.inkFaint)
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        LazyVGrid(columns: columns, spacing: 3) {
                            ForEach(Array(month.cells.enumerated()), id: \.offset) { _, cell in
                                RoundedRectangle(cornerRadius: 3, style: .continuous)
                                    .fill(cellColor(cell))
                                    .aspectRatio(1, contentMode: .fit)
                            }
                        }
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(Self.legend, id: \.1) { sport, label in
                                HStack(spacing: 3) {
                                    Circle().fill(WarmInstrument.sportColor(sport)).frame(width: 6, height: 6)
                                    Text(label)
                                        .font(.system(size: 8, weight: .semibold, design: .monospaced))
                                        .foregroundColor(WarmInstrument.inkMuted)
                                }
                            }
                        }
                    }
                }

                HStack(spacing: 18) {
                    stat("\(activity.longestBlock)D", "LONGEST BLOCK")
                    stat(activity.planTruePercent.map { "\(Int($0))%" } ?? "—", "PLAN-TRUE")
                    stat("\(activity.gapCount)", "GAPS · WORST \(activity.worstGap)D")
                }

                Text(activity.read)
                    .font(.system(size: 11))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }

    private func pageButton(system: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            withAnimation(.spring(duration: 0.25)) { action() }
        } label: {
            Image(systemName: system)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(enabled ? WarmInstrument.ink : WarmInstrument.inkFaint)
                .frame(width: 24, height: 24)
                .background(WarmInstrument.surfaceMuted)
                .clipShape(Circle())
        }
        .disabled(!enabled)
    }

    private func cellColor(_ cell: ActivityCellState) -> Color {
        switch cell {
        case .empty: return WarmInstrument.border
        case .plannedMissed: return WarmInstrument.alarmBg
        default:
            guard let sport = WarmSportId(rawValue: cell.rawValue) else { return WarmInstrument.inkFaint }
            return WarmInstrument.sportColor(sport)
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(WarmInstrument.figures(14, weight: .bold))
                .foregroundColor(WarmInstrument.ink)
            MonoLabel(label, size: 8)
        }
    }
}

// MARK: - P1: Coach's read

private struct CoachReadWidget: View {
    let read: CoachReadSnapshot

    var body: some View {
        WarmCard(fill: WarmInstrument.surfaceMuted) {
            VStack(alignment: .leading, spacing: 10) {
                MonoLabel("\(read.eyebrow ?? "COACH'S READ") · \(read.dateLabel)")
                Text(read.body)
                    .font(.system(size: 15, design: .serif).italic())
                    .foregroundColor(WarmInstrument.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(read.signature ?? "— PHELPS")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }
}

// MARK: - P2: Build phase

private struct BuildPhaseWidget: View {
    let phase: BuildPhaseSnapshot

    private let railLabels = ["BLOCK 1", "DELOAD", "BLOCK 2", "TEST"]
    private let railFlex: [CGFloat] = [4, 1.2, 4, 1.2]

    var body: some View {
        WarmCard(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    MonoLabel(phase.title ?? "BUILD PHASE", size: 10)
                    Spacer()
                    MonoLabel(phase.weekLabel, size: 9.5, color: WarmInstrument.accent)
                }

                VStack(spacing: 6) {
                    HStack(spacing: 3) {
                        ForEach(0..<4, id: \.self) { index in
                            phaseRailSegment(index: index)
                                .frame(maxWidth: .infinity)
                                .layoutPriority(railFlex[index])
                        }
                    }
                    .frame(height: 9)

                    HStack(spacing: 3) {
                        ForEach(Array(railLabels.enumerated()), id: \.offset) { index, label in
                            Text(label)
                                .font(.system(size: 8, weight: .regular, design: .monospaced))
                                .foregroundColor(WarmInstrument.inkFaint)
                                .frame(maxWidth: .infinity, alignment: index == railLabels.count - 1 ? .trailing : .leading)
                                .layoutPriority(railFlex[index])
                        }
                    }
                    .frame(height: 12)
                }

                if phase.milestones.isEmpty {
                    Text("No milestones tracked for this block yet.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                } else {
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(phase.milestones.prefix(2), id: \.name) { milestone in
                            HStack(alignment: .firstTextBaseline) {
                                Text(milestone.name)
                                    .font(.system(size: 12.5, weight: .semibold))
                                    .foregroundColor(WarmInstrument.ink)
                                    .lineLimit(1)
                                Spacer(minLength: 8)
                                milestoneLine(milestone)
                            }
                        }
                    }
                }

                Text(phase.read)
                    .font(WarmInstrument.coachVoice(14))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func phaseRailSegment(index: Int) -> some View {
        switch index {
        case 0:
            ZStack(alignment: .trailing) {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(WarmInstrument.accent)
                Rectangle()
                    .fill(WarmInstrument.ink)
                    .frame(width: 2, height: 15)
                    .offset(x: -4, y: -3)
            }
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
        case 1:
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(Color(red: 0xe0 / 255, green: 0xb0 / 255, blue: 0x6e / 255))
        case 2:
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .strokeBorder(Color(red: 0xc9 / 255, green: 0xc2 / 255, blue: 0xb2 / 255), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        default:
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .strokeBorder(WarmInstrument.accent.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        }
    }

    @ViewBuilder
    private func milestoneLine(_ milestone: PhaseMilestoneSnapshot) -> some View {
        let current = milestone.current ?? milestone.baseline
        HStack(spacing: 4) {
            Text(current)
            Text("→")
            if let projected = milestone.projectedDateLabel {
                Text("\(milestone.target) · \(projected.uppercased())")
                    .foregroundColor(WarmInstrument.accent)
            } else {
                Text(milestone.target)
                    .foregroundColor(WarmInstrument.accent)
            }
        }
        .font(WarmInstrument.figures(10))
        .foregroundColor(WarmInstrument.inkMuted)
        .lineLimit(1)
    }
}

// MARK: - P2: VO2 max (opt-in empty)

private struct Vo2Widget: View {
    let vo2: Vo2Snapshot

    var body: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    MonoLabel("VO₂ MAX · 12 MO")
                    Spacer()
                    MonoLabel(
                        vo2.isAvailable ? (vo2.percentileLabel ?? "") : "NOT IMPORTED",
                        color: vo2.isAvailable ? WarmInstrument.accent : WarmInstrument.inkFaint
                    )
                }

                if vo2.isAvailable, let value = vo2.value {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(String(format: "%.1f", value))
                            .font(WarmInstrument.figures(28, weight: .bold))
                            .foregroundColor(WarmInstrument.ink)
                        if let delta = vo2.delta {
                            Text("ml/kg/min · ▲ \(String(format: "%.1f", delta))")
                                .font(.system(size: 11))
                                .foregroundColor(WarmInstrument.inkMuted)
                        }
                    }
                    if vo2.trend.count > 1 {
                        Vo2Sparkline(points: vo2.trend).frame(height: 36)
                    }
                } else {
                    Text("No Apple Health VO₂ observations")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                }

                Text(vo2.read)
                    .font(.system(size: 11))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }
}

private struct Vo2Sparkline: View {
    let points: [TrendPointSnapshot]

    var body: some View {
        let values = points.map(\.value)
        let minV = values.min() ?? 0
        let maxV = values.max() ?? 1
        let range = max(1, maxV - minV)
        GeometryReader { geo in
            Path { path in
                for (index, point) in points.enumerated() {
                    let x = geo.size.width * CGFloat(index) / CGFloat(max(1, points.count - 1))
                    let y = geo.size.height - geo.size.height * CGFloat((point.value - minV) / range)
                    if index == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(WarmInstrument.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
    }
}

// MARK: - P2: Calories

private struct CaloriesWidget: View {
    let calories: CaloriesSnapshot
    var compact: Bool = false

    /// Issue #68: the live pipeline can still ship a fabricated 12,000 kcal target with
    /// `targetIsFixture: false`, as if it were earned. Gate on all three signals — no target,
    /// an explicit fixture flag, or the known hardcoded value — so Home never renders it as
    /// real regardless of whether the upstream field is trustworthy yet.
    private static let knownFixtureHardcode: Double = 12_000

    private var hasTarget: Bool {
        guard let target = calories.target, target > 0 else { return false }
        if calories.targetIsFixture == true { return false }
        if target == Self.knownFixtureHardcode { return false }
        return true
    }

    private var progress: Double {
        hasTarget ? min(1, calories.current / calories.target!) : min(1, calories.pacePercent / 100)
    }

    var body: some View {
        WarmCard(padding: compact ? 16 : 16) {
            VStack(alignment: .leading, spacing: compact ? 0 : 10) {
                HStack {
                    MonoLabel("CALORIES · \(calories.monthLabel)", size: compact ? 9 : 10)
                    if !compact {
                        Spacer()
                        MonoLabel("\(calories.daysLeft)D LEFT")
                    }
                }

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(compact(calories.current))
                        .font(WarmInstrument.figures(26, weight: .bold))
                        .foregroundColor(WarmInstrument.ink)
                        .contentTransition(.numericText())
                    Text(hasTarget ? "/ \(compact(calories.target!))" : "KCAL")
                        .font(WarmInstrument.figures(compact ? 11 : 11, weight: .regular))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
                .padding(.top, compact ? 10 : 0)

                ZStack(alignment: .leading) {
                    HairlineProgress(fraction: progress, tint: WarmInstrument.accent, height: compact ? 8 : 6)
                    GeometryReader { geo in
                        Rectangle()
                            .fill(WarmInstrument.ink)
                            .frame(width: 2, height: compact ? 12 : 6)
                            .offset(x: geo.size.width * CGFloat(min(1, calories.pacePercent / 100)) - 1, y: compact ? -2 : 0)
                    }
                    .frame(height: compact ? 8 : 6)
                }
                .padding(.top, compact ? 14 : 0)

                if compact {
                    HStack {
                        Text(hasTarget && calories.dailyNeeded != nil
                             ? "\(Int(calories.dailyNeeded!))/DAY"
                             : "MONTH TO DATE")
                            .font(.system(size: 8, weight: .bold, design: .monospaced))
                            .foregroundColor(WarmInstrument.accent)
                        Spacer()
                        Text("\(calories.daysLeft)D LEFT")
                            .font(.system(size: 8, weight: .regular, design: .monospaced))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                    .padding(.top, 6)
                } else {
                    Text(hasTarget && calories.dailyNeeded != nil
                         ? "\(Int(calories.dailyNeeded!))/DAY NEEDED"
                         : "MONTH TO DATE")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: compact ? 148 : nil, alignment: .leading)
        }
    }

    private func compact(_ value: Double) -> String {
        value >= 1000 ? String(format: "%.1fK", value / 1000) : "\(Int(value))"
    }
}

// MARK: - Opened Engine (Phone 2 in Warm Instrument Mobile.dc.html)

struct EngineDetailView: View {
    let engine: EngineSnapshot
    let coachRead: CoachReadSnapshot

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                headerBar

                VStack(alignment: .leading, spacing: 18) {
                    heroCard
                    doseLedger
                    coachReadCard
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
        }
        .mainTabScrollBottomClearance()
        .background(WarmInstrument.paper.ignoresSafeArea())
        .navigationBarBackButtonHidden(false)
    }

    private var headerBar: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Engine")
                .font(.system(size: 19, weight: .semibold))
                .foregroundColor(WarmInstrument.ink)
            Text(engine.weekLabel.uppercased())
                .font(WarmInstrument.monoLabel(10))
                .tracking(1.2)
                .foregroundColor(WarmInstrument.inkFaint)
            Spacer()
            Text(engine.signal.uppercased())
                .font(WarmInstrument.monoLabel(10))
                .tracking(1.0)
                .foregroundColor(WarmInstrument.sportColor(.badminton))
                .padding(.horizontal, 7)
                .padding(.vertical, 2)
                .overlay(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .strokeBorder(WarmInstrument.sportColor(.badminton).opacity(0.4), lineWidth: 1)
                )
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(WarmInstrument.headerRule).frame(height: 1)
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(loadLabel)
                    .font(.system(size: 54, weight: .medium))
                    .tracking(-2.5)
                    .foregroundColor(.white)
                if let low = engine.bandLow, let high = engine.bandHigh {
                    Text("of \(Int(low))–\(Int(high))\nusual rhythm")
                        .font(.system(size: 12))
                        .foregroundColor(.white.opacity(0.6))
                        .lineSpacing(2)
                }
                Spacer(minLength: 0)
                Text(engine.openVerdict ?? engine.compactVerdict ?? engine.verdict)
                    .font(WarmInstrument.coachVoice(17))
                    .foregroundColor(.white.opacity(0.95))
                    .multilineTextAlignment(.trailing)
            }

            EngineDetailGauge(engine: engine)
                .frame(height: 52)

            Text(engine.method.uppercased())
                .font(.system(size: 9, weight: .regular, design: .monospaced))
                .tracking(0.4)
                .foregroundColor(.white.opacity(0.5))
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color.white.opacity(0.06), .clear],
                        startPoint: .topLeading,
                        endPoint: UnitPoint(x: 0.45, y: 0.45)
                    )
                )
                .background(WarmInstrument.accent)
        )
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var doseLedger: some View {
        VStack(alignment: .leading, spacing: 10) {
            MonoLabel("THIS WEEK'S DOSE", size: 10)

            VStack(spacing: 0) {
                ForEach(Array(engine.doseRows.enumerated()), id: \.element.id) { index, row in
                    HStack(alignment: .center, spacing: 12) {
                        Text(row.day.uppercased())
                            .font(WarmInstrument.monoLabel(10, weight: .regular))
                            .foregroundColor(WarmInstrument.inkFaint)
                            .frame(width: 30, alignment: .leading)

                        if row.isRest == true {
                            Text(row.title)
                                .font(.system(size: 13.5, weight: .semibold))
                                .foregroundColor(WarmInstrument.inkFaint)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text("—")
                                .font(WarmInstrument.figures(11))
                                .foregroundColor(WarmInstrument.inkFaint)
                        } else {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.title)
                                    .font(.system(size: 13.5, weight: .semibold))
                                    .foregroundColor(WarmInstrument.ink)
                                if let detail = row.detail, !detail.isEmpty {
                                    Text(detail.uppercased())
                                        .font(WarmInstrument.monoLabel(10, weight: .regular))
                                        .foregroundColor(WarmInstrument.inkFaint)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)

                            if let load = row.load {
                                Text("+\(Int(load))")
                                    .font(WarmInstrument.figures(11, weight: .bold))
                                    .foregroundColor(WarmInstrument.sportColor(row.sport))
                            }
                        }
                    }
                    .padding(.vertical, 11)

                    if index < engine.doseRows.count - 1 {
                        Divider().overlay(WarmInstrument.headerRule)
                    }
                }
            }
        }
    }

    private var coachReadCard: some View {
        WarmCard(padding: 16, fill: WarmInstrument.surfaceMuted) {
            VStack(alignment: .leading, spacing: 7) {
                MonoLabel(coachRead.eyebrow ?? "COACH'S READ", size: 10)
                Text(coachRead.body)
                    .font(WarmInstrument.coachVoice(16.5))
                    .foregroundColor(WarmInstrument.ink)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var loadLabel: String {
        engine.load == engine.load.rounded() ? "\(Int(engine.load))" : String(format: "%.1f", engine.load)
    }
}

private struct EngineDetailGauge: View {
    let engine: EngineSnapshot

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let range = max(1, engine.scaleHigh - engine.scaleLow)
            let x: (Double) -> CGFloat = { value in
                CGFloat((value - engine.scaleLow) / range) * width
            }
            let bandLow = engine.bandLow ?? engine.load * 0.8
            let bandHigh = engine.bandHigh ?? engine.load * 1.2
            let markerX = x(engine.load)
            let bandX = x(bandLow)
            let bandWidth = max(12, x(bandHigh) - bandX)

            ZStack(alignment: .topLeading) {
                Path { path in
                    path.move(to: CGPoint(x: 0, y: 28))
                    path.addLine(to: CGPoint(x: width, y: 28))
                }
                .stroke(Color.white.opacity(0.3), lineWidth: 1)

                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(Color.white.opacity(0.2))
                    .frame(width: bandWidth, height: 16)
                    .offset(x: bandX, y: 20)

                Path { path in
                    path.move(to: CGPoint(x: markerX, y: 16))
                    path.addLine(to: CGPoint(x: markerX + 5, y: 5))
                    path.addLine(to: CGPoint(x: markerX - 5, y: 5))
                    path.closeSubpath()
                }
                .fill(Color.white)

                Path { path in
                    path.move(to: CGPoint(x: markerX, y: 16))
                    path.addLine(to: CGPoint(x: markerX, y: 40))
                }
                .stroke(Color.white, lineWidth: 2)

                Text("\(Int(bandLow))")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.white.opacity(0.7))
                    .position(x: bandX, y: 8)

                Text("\(Int(bandHigh))")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.white.opacity(0.7))
                    .position(x: bandX + bandWidth, y: 8)

                Text("\(Int(engine.scaleLow))")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.white.opacity(0.5))
                    .position(x: 0, y: 48)

                Text("\(Int(engine.scaleHigh))")
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundColor(.white.opacity(0.5))
                    .position(x: width, y: 48)
            }
        }
    }
}

// MARK: - Home skeleton loading

/// Shimmer placeholder cards that match the visual weight of the actual widget column —
/// shown while the snapshot fetch is in-flight so the screen never opens empty.
private struct HomeSkeletonView: View {
    var body: some View {
        VStack(spacing: 14) {
            HomeSkeletonCard(height: 172)
            HomeSkeletonCard(height: 78)
            HomeSkeletonCard(height: 96)
            HStack(spacing: 14) {
                HomeSkeletonCard(height: 148)
                HomeSkeletonCard(height: 148)
            }
            HomeSkeletonCard(height: 112)
            HomeSkeletonCard(height: 138)
        }
    }
}

private struct HomeSkeletonCard: View {
    let height: CGFloat
    @State private var pulsing = false

    var body: some View {
        RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
            .fill(WarmInstrument.surfaceMuted)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .overlay(
                RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                    .strokeBorder(WarmInstrument.border, lineWidth: 1)
            )
            .opacity(pulsing ? 0.45 : 0.85)
            .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: pulsing)
            .onAppear { pulsing = true }
    }
}

#Preview("Engine detail — golden dataset") {
    NavigationStack {
        EngineDetailView(engine: GoldenDataset.engine, coachRead: GoldenDataset.home.coachRead)
    }
}

#Preview("Warm Instrument Home — golden dataset") {
    let auth = GitHubAuthManager()
    let store = WidgetSnapshotStore()
    store.snapshots = GoldenDataset.snapshots
    return WarmInstrumentHomeView()
        .environmentObject(auth)
        .environmentObject(store)
}
