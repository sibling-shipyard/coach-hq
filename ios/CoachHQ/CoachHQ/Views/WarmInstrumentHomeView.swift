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
    @EnvironmentObject var allActivitiesStore: AllActivitiesStore

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

    /// Home's widget order, stored as a comma-joined `WidgetCatalogKey.rawValue` list (W6) —
    /// `@AppStorage` doesn't hold arrays directly. `homeOrder` below is the typed read of this;
    /// the parse/encode logic lives in `WidgetCatalogKey` itself so it's testable without a
    /// constructed view.
    @AppStorage("wiHomeOrder") private var homeOrderRaw = WidgetCatalogKey.encodeOrder(WidgetCatalogKey.defaultOrder)

    private var homeOrder: [WidgetCatalogKey] { WidgetCatalogKey.parseOrder(homeOrderRaw) }

    /// Compact calories + quest share this height (`CaloriesCard` / `QuestCard`).
    private static let caloriesQuestPairMinHeight: CGFloat = 148

    var body: some View {
        NavigationStack(path: $navigationPath) {
            ScrollView {
                VStack(spacing: 14) {
                    WarmPageHeader(title: "HOME", trailing: WarmPageDate.label())

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
                    } else if authManager.selectedRepo == nil,
                              authManager.isSessionReady,
                              store.isConfigured,
                              !store.isLoading {
                        repoNotConfiguredState
                    } else if authManager.isSessionReady, store.isConfigured, !store.isLoading {
                        emptyState
                    }
                }
                .frame(maxWidth: .infinity, alignment: .top)
                .padding(.horizontal, 16)
                .animation(PremiumMotion.statsLoad, value: store.snapshots != nil)
            }
            // Dock ~84pt is shorter than the calories/quest pair (minHeight 148). Local
            // inset only — Theme.mainTabScrollBottomClearance stays shared.
            .contentMargins(
                .bottom,
                WarmMainDockLayout.dockHeight
                    + Self.caloriesQuestPairMinHeight
                    + WarmMainDockLayout.scrollBottomBreathingRoom,
                for: .scrollContent
            )
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
                            engine: snapshots.home.engine
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
                if let repo = authManager.repoFullName {
                    Task {
                        await allActivitiesStore.ingestNewHist(
                            repo: repo,
                            client: GitHubActivityHistClient(authManager: authManager)
                        )
                    }
                }
            }
            .onChange(of: syncManager.coachReplyHomeCopy) { _, copy in
                guard let copy, !copy.isEmpty else { return }
                toast = Toast(kind: .success, message: copy)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                guard store.isConfigured else { return }
                Task { await store.refresh(showSpinner: false) }
            }
            .overlay {
                WarmPageWaitCover(isWaiting: homePageWaiting, holdOnAppear: true)
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

    /// First paint without snapshots. Pull-to-refresh keeps snapshots and is not a page wait.
    private var homePageWaiting: Bool {
        store.snapshots == nil
            && (!authManager.isSessionReady || !store.isConfigured || store.isLoading)
    }

    // MARK: - Widget column

    @ViewBuilder
    private func widgetColumn(for snapshots: WidgetSnapshotsFile) -> some View {
        // Order is stored data (homeOrder, W6): an unrecognized key — a future addition this
        // build doesn't know yet — is dropped by homeOrder's compactMap, never crashes here.
        ForEach(Array(homeOrder.enumerated()), id: \.element) { index, key in
            widgetView(for: key, snapshots: snapshots, revealDelay: 0.30 + Double(index) * 0.10)
        }
    }

    /// One entry from the catalog, in its full existing chrome (edit-mode wrapper, jiggle
    /// phase, reveal animation) — unchanged from each widget's pre-W6 body, just keyed instead
    /// of inlined in a fixed sequence.
    @ViewBuilder
    private func widgetView(for key: WidgetCatalogKey, snapshots: WidgetSnapshotsFile, revealDelay: Double) -> some View {
        let home = snapshots.home

        switch key {
        case .engine:
            // Engine — tap opens dose ledger + coach read
            EditableWidget(isEditing: $isEditingLayout, sizeBinding: $engineSize, sizeOptions: ["S", "M", "L"], jigglePhase: 0.00) {
                Button {
                    Haptics.tap()
                    navigationPath.append(.engine)
                } label: {
                    EngineCard(size: WidgetSize(rawValue: engineSize) ?? .m, sizes: snapshots.sizes.engine)
                }
                .buttonStyle(CardPressButtonStyle())
            }
            .scaleEffect(enginePulse ? 1.02 : 1)
            .animation(.spring(duration: 0.45, bounce: 0.35), value: enginePulse)
            .staggerReveal(delay: revealDelay)
            .overlay {
                if !engineOverlayDismissed {
                    EngineFirstVisitOverlay {
                        withAnimation(.easeOut(duration: 0.25)) { engineOverlayDismissed = true }
                    }
                    .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.25), value: engineOverlayDismissed)

        case .commitments:
            // Sport commitment quartet strip
            EditableWidget(isEditing: $isEditingLayout, sizeBinding: $commitmentsSize, sizeOptions: ["S", "M"], jigglePhase: 0.05) {
                CommitmentCard(
                    size: WidgetSize(rawValue: commitmentsSize) ?? .m,
                    sizes: snapshots.sizes.commitments,
                    showingRanked: $badmintonShowsRanked
                )
            }
            .staggerReveal(delay: revealDelay)

        case .weeklyPlan:
            // Chip drag owns long-press; not wrapped in jiggle editor.
            WeeklyPlanCard(plan: home.plan, compact: true)
                .staggerReveal(delay: revealDelay)

        case .caloriesAndQuest:
            HStack(spacing: 14) {
                EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.15) {
                    CaloriesCard(calories: home.calories, compact: true)
                }
                EditableWidget(isEditing: $isEditingLayout, sizeBinding: $questSize, sizeOptions: ["S", "M"], jigglePhase: 0.20) {
                    QuestCard(size: WidgetSize(rawValue: questSize) ?? .m, home: home.quest, small: snapshots.sizes.quest.S, compact: true)
                }
            }
            .staggerReveal(delay: revealDelay)

        case .buildPhase:
            EditableWidget(isEditing: $isEditingLayout, jigglePhase: 0.25) {
                BuildPhaseCard(phase: home.phase)
            }
            .staggerReveal(delay: revealDelay)

        case .recentSessions:
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
            .staggerReveal(delay: revealDelay)
        }
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

    private func openCoachMessage(_ message: CoachMessageSnapshot, playHaptic: Bool = true) {
        guard let repoFullName = authManager.repoFullName,
              let route = CoachMessageRoute(
                repoFullName: repoFullName,
                conversationSeedId: message.conversationSeedId,
                body: message.body,
                createdAt: message.createdAt
              ) else { return }
        if playHaptic { Haptics.tap() }
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
        homeTypedEmpty(
            kicker: "REPO",
            body: "Signed in as \(authManager.user?.login ?? "GitHub"), but no coach repo was found. Check Settings for the linked repo."
        )
    }

    private var emptyState: some View {
        homeTypedEmpty(
            kicker: "HOME",
            body: "Home isn't synced yet. Pull down to fetch this week's snapshot."
        )
    }

    private var fetchFailedState: some View {
        homeTypedEmpty(
            kicker: "HOME",
            body: "Couldn't load this week's snapshot. Pull down to try again."
        )
    }

    /// Mono kicker + serif italic body — Home's empty language, not SF Symbol + caption.
    private func homeTypedEmpty(kicker: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(kicker)
                .font(WarmInstrument.monoLabel(10))
                .tracking(1.2)
                .foregroundColor(WarmInstrument.inkFaint)
            Text(body)
                .font(WarmInstrument.coachVoice(16))
                .foregroundColor(WarmInstrument.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 48)
        .padding(.horizontal, 6)
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
                    .foregroundColor(WarmInstrument.onAccent)
                Text("Coach uses your training dose score to calibrate what's next. Tap the Engine any time for the full breakdown.")
                    .font(WarmInstrument.coachVoice(13))
                    .foregroundColor(WarmInstrument.onAccent.opacity(0.88))
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                Text("TAP TO DISMISS")
                    .font(WarmInstrument.monoLabel(9))
                    .tracking(0.8)
                    .foregroundColor(WarmInstrument.onAccent.opacity(0.45))
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

#Preview("Warm Instrument Home — golden dataset") {
    let auth = GitHubAuthManager()
    let store = WidgetSnapshotStore()
    store.snapshots = GoldenDataset.snapshots
    return WarmInstrumentHomeView()
        .environmentObject(auth)
        .environmentObject(store)
        .environmentObject(AllActivitiesStore())
}
