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
    @AppStorage("preferredName") private var preferredName = ""

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(spacing: 14) {
                    if let snapshots = store.snapshots {
                        if !preferredName.isEmpty {
                            greetingRow
                                .staggerReveal(delay: 0.10)
                        }
                        CompactInstrumentHeader(phase: snapshots.home.phase)

                        if !snapshots.home.sync.healthy {
                            SyncWarningBanner(sync: snapshots.home.sync)
                        }

                        if let message = snapshots.home.coachMessage {
                            CoachMessageCard(message: message) {
                                openCoachMessage(message)
                            }
                            .staggerReveal(delay: 0.25)
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
                    // Full paginated history, not the 7-day widget cache — see
                    // AllActivitiesListView's doc comment for why it's a separate view.
                    AllActivitiesListView(
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
            .onAppear {
                syncManager.attachCoachChatClient(CoachChatAPIClient(authManager: authManager))
            }
            .onChange(of: syncManager.lastSyncResult) { _, result in
                guard let result, case .synced(let n) = result.outcome, n > 0 else { return }
                toast = Toast(kind: .success, message: syncToastMessage(n: n))
                enginePulse = true
                Task { try? await Task.sleep(for: .seconds(0.55)); enginePulse = false }
            }
            .onChange(of: syncManager.coachReplyHomeCopy) { _, copy in
                guard let copy, !copy.isEmpty else { return }
                toast = Toast(kind: .success, message: copy)
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
                EngineCard(size: WidgetSize(rawValue: engineSize) ?? .m, sizes: snapshots.sizes.engine)
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
            CommitmentCard(
                size: WidgetSize(rawValue: commitmentsSize) ?? .m,
                sizes: snapshots.sizes.commitments,
                showingRanked: $badmintonShowsRanked
            )
        }
        .staggerReveal(delay: 0.40)

        // Weekly plan — chip drag owns long-press; not wrapped in jiggle editor.
        WeeklyPlanCard(plan: home.plan, compact: true)
            .staggerReveal(delay: 0.50)

        // Calories + main quest side-by-side
        HStack(spacing: 14) {
            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.15) {
                CaloriesCard(calories: home.calories, compact: true)
            }
            EditableWidget(isEditing: $isEditingLayout, sizeBinding: $questSize, sizeOptions: ["S", "M"], jigglePhase: 0.20) {
                QuestCard(size: WidgetSize(rawValue: questSize) ?? .m, home: home.quest, small: snapshots.sizes.quest.S, compact: true)
            }
        }
        .staggerReveal(delay: 0.60)

        EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.25) {
            BuildPhaseCard(phase: home.phase)
        }
        .staggerReveal(delay: 0.70)

        EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.30) {
            RecentSessionsCard(
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

    private var greetingRow: some View {
        let hour = Calendar.current.component(.hour, from: Date())
        let salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
        return HStack {
            Text("\(salutation), \(preferredName)")
                .font(WarmInstrument.coachVoice(13))
                .foregroundColor(WarmInstrument.inkMuted)
            Spacer()
        }
        .padding(.horizontal, 6)
    }

    private func syncToastMessage(n: Int) -> String {
        let rounds = syncManager.lastRoundSynced
        if rounds.count == 1, let (sportType, _) = rounds.first {
            let label = Theme.sportBadge(for: sportType).label.capitalized
            return "\(label) session synced — Coach is on it"
        }
        let word = n == 1 ? "session" : "sessions"
        return "\(n) \(word) synced — Coach is on it"
    }

    private func openCoachMessage(_ message: CoachMessageSnapshot) {
        guard let repoFullName = authManager.repoFullName,
              let route = CoachMessageRoute(
                repoFullName: repoFullName,
                conversationSeedId: message.conversationSeedId,
                body: message.body,
                createdAt: message.createdAt
              ) else { return }
        Haptics.tap()
        route.persist()
        NotificationCenter.default.post(name: .navigateToChat, object: route)
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
        CoachReadCard(read: coachRead)
    }

    private var loadLabel: String { Format.number(engine.load) }
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
