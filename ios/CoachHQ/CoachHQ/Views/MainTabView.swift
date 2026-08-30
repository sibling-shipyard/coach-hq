import SwiftUI
import UserNotifications

/// Child views set this preference to hide the floating `WarmTabBar` (e.g. workout overview, activity detail).
private struct TabBarHiddenPreferenceKey: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) {
        value = value || nextValue()
    }
}

extension View {
    /// Hides the main floating tab bar when pushed detail screens need full bottom space.
    func hidesMainTabBar(_ hidden: Bool = true) -> some View {
        toolbar(hidden ? .hidden : .visible, for: .tabBar)
            .preference(key: TabBarHiddenPreferenceKey.self, value: hidden)
    }
}

enum AppTab: Hashable, CaseIterable {
    case home, chat, workouts, you

    var diagnosticViewName: String {
        switch self {
        case .home: "HomeView"
        case .chat: "CoachChatView"
        case .workouts: "WorkoutListView"
        case .you: "SettingsView"
        }
    }

    var outlineIcon: String {
        switch self {
        case .home: return "house"
        case .chat: return "bubble.left.and.bubble.right"
        case .workouts: return "dumbbell"
        case .you: return "person.circle"
        }
    }

    var filledIcon: String {
        switch self {
        case .home: return "house.fill"
        case .chat: return "bubble.left.and.bubble.right.fill"
        case .workouts: return "dumbbell.fill"
        case .you: return "person.circle.fill"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .home: return "Home"
        case .chat: return "Coach Chat"
        case .workouts: return "Workouts"
        case .you: return "You"
        }
    }

    var labelText: String {
        switch self {
        case .home: return "Home"
        case .chat: return "Coach"
        case .workouts: return "Train"
        case .you: return "You"
        }
    }
}

/// Account-scoped handoff from Home or a local notification into the exact proactive thread.
struct CoachMessageRoute: Codable, Equatable {
    let repoFullName: String
    let conversationSeedId: String
    let body: String
    let createdAt: String?

    private static let storageKey = "pendingCoachMessageRoute"

    init?(
        repoFullName: String,
        conversationSeedId: String,
        body: String,
        createdAt: String? = nil
    ) {
        let messageId = String(conversationSeedId.dropFirst("local-proactive-".count))
        guard repoFullName.range(
                of: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$",
                options: .regularExpression
              ) != nil,
              conversationSeedId == "local-proactive-\(messageId)",
              messageId.range(
                of: "^cm-[A-Za-z0-9-]{1,160}$",
                options: .regularExpression
              ) != nil,
              !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              body.count <= 360 else { return nil }
        self.repoFullName = repoFullName
        self.conversationSeedId = conversationSeedId
        self.body = body
        self.createdAt = createdAt
    }

    init?(userInfo: [AnyHashable: Any]) {
        guard let repo = userInfo["repoFullName"] as? String,
              let seed = userInfo["conversationSeedId"] as? String,
              let body = userInfo["coachMessageBody"] as? String else { return nil }
        self.init(
            repoFullName: repo,
            conversationSeedId: seed,
            body: body,
            createdAt: userInfo["createdAt"] as? String
        )
    }

    func persist() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(data, forKey: Self.storageKey)
    }

    /// Returns the persisted route only for the matching repo. A nil match leaves
    /// storage so a cold-launch notification survives until the repo is known.
    static func load(matching repoFullName: String?) -> CoachMessageRoute? {
        guard let repoFullName else { return nil }
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode(CoachMessageRoute.self, from: data),
              let route = CoachMessageRoute(
                repoFullName: decoded.repoFullName,
                conversationSeedId: decoded.conversationSeedId,
                body: decoded.body,
                createdAt: decoded.createdAt
              ),
              route.repoFullName == repoFullName else {
            clear()
            return nil
        }
        return route
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }
}

struct MainTabView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var workoutService: WorkoutService
    @EnvironmentObject var widgetStore: WidgetSnapshotStore
    @EnvironmentObject var bottomDock: BottomDockState
    @EnvironmentObject var router: AppRouter
    @State private var selectedTab: AppTab = .home
    @State private var tabBarHidden = false
    @AppStorage("chatHasUnread") private var chatHasUnread = false
    @AppStorage("pendingChatNavigation") private var pendingChatNavigation = false
    @State private var pendingCoachMessageRoute: CoachMessageRoute?
    @State private var showRageReport = false

    var body: some View {
        ZStack(alignment: .bottom) {
            ZStack {
                tabRoot(.home) {
                    WarmInstrumentHomeView()
                }
                tabRoot(.chat) {
                    // Gated on effectivePhase == .complete (not just opacity, like the other
                    // tabs) - CoachChatView's .task fires greetNow() as soon as it's created,
                    // and greetNow() reads OnboardingHints.load() to hand name/sports to the
                    // server's First Session Protocol greet. Creating this view before
                    // PersonalizeView/OnboardingRevealFlow have saved those hints means
                    // greetNow() reads them back empty, so the server never records them and
                    // Coach re-asks for both in chat (#671). Deferring construction itself,
                    // not just visibility, ensures the .task's first run only happens once
                    // those hints actually exist.
                    if router.effectivePhase == .complete {
                        CoachChatView(requestedProactiveRoute: $pendingCoachMessageRoute)
                            .environmentObject(authManager)
                    }
                }
                tabRoot(.workouts) {
                    WorkoutListView()
                        .environmentObject(workoutService)
                }
                tabRoot(.you) {
                    SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            // Hide tab content while onboarding fullScreenCovers are active so neither the
            // initial HK prompt appearance nor the gap between HK prompt dismissal and reveal
            // presentation exposes a flash of the home tab underneath.
            .opacity(router.effectivePhase == .hkPrompt || router.effectivePhase == .reveal ? 0 : 1)
            .allowsHitTesting(router.effectivePhase == .complete || router.effectivePhase == .notStarted)

            if !tabBarHidden && !authManager.sessionExpired {
                bottomDockContent
            }

            // Name prompt — first step of onboarding. Collects the athlete's preferred name
            // before HealthKit permission. effectivePhase returns .complete when sessionExpired
            // so this overlay never renders over the expired screen.
            if router.effectivePhase == .notStarted {
                NamePromptView {
                    selectedTab = .chat
                    router.advance(.splashDismissed)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea()
                .zIndex(100)
            }
        }
        .overlay {
            if authManager.sessionExpired {
                SessionExpiredView(authManager: authManager)
                    .background(WarmInstrument.desk.ignoresSafeArea())
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: authManager.sessionExpired)
        .sheet(isPresented: $showRageReport) { RageReportView() }
        .onReceive(NotificationCenter.default.publisher(for: .shakeGestureDetected)) { _ in
            guard router.effectivePhase == .complete, !authManager.sessionExpired else { return }
            Haptics.tap()
            showRageReport = true
        }
        .onPreferenceChange(TabBarHiddenPreferenceKey.self) { tabBarHidden = $0 }
        .animation(PremiumMotion.dock, value: tabBarHidden)
        .background(WarmInstrument.desk.ignoresSafeArea())
        .onAppear {
            DiagnosticsManager.setAthlete(repoFullName: authManager.repoFullName)
            DiagnosticsManager.setView(selectedTab.diagnosticViewName)
            pendingCoachMessageRoute = CoachMessageRoute.load(matching: authManager.repoFullName)
            if pendingChatNavigation {
                pendingChatNavigation = false
                selectedTab = .chat
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToChat)) { notification in
            if let route = notification.object as? CoachMessageRoute {
                if route.repoFullName == authManager.repoFullName {
                    route.persist()
                    pendingCoachMessageRoute = route
                } else {
                    CoachMessageRoute.clear()
                    pendingCoachMessageRoute = nil
                }
            } else {
                pendingCoachMessageRoute = CoachMessageRoute.load(matching: authManager.repoFullName)
            }
            pendingChatNavigation = false
            withAnimation(PremiumMotion.state) { selectedTab = .chat }
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToHome)) { _ in
            withAnimation(PremiumMotion.state) { selectedTab = .home }
        }
        .onChange(of: authManager.repoFullName) { _, repoFullName in
            DiagnosticsManager.setAthlete(repoFullName: repoFullName)
            pendingCoachMessageRoute = CoachMessageRoute.load(matching: repoFullName)
        }
        .onChange(of: selectedTab) { _, newTab in
            DiagnosticsManager.setView(newTab.diagnosticViewName)
            if newTab == .chat { chatHasUnread = false }
            if newTab == .home, widgetStore.shouldRefresh {
                Task { await widgetStore.refresh(showSpinner: false) }
            }
        }
        .onChange(of: chatHasUnread) { _, hasUnread in
            if hasUnread && selectedTab == .chat { chatHasUnread = false }
            Task { try? await UNUserNotificationCenter.current().setBadgeCount(hasUnread ? 1 : 0) }
        }
        // HK pre-prompt → reveal — single cover stays open across the phase transition so the
        // home tab never flashes in the gap between two separate covers dismissing/presenting.
        .fullScreenCover(isPresented: Binding(
            get: { router.effectivePhase == .hkPrompt || router.effectivePhase == .reveal },
            set: { _ in }
        )) {
            if router.effectivePhase == .hkPrompt {
                HealthKitPrePromptView(
                    onConnect: {
                        Task {
                            await syncManager.connectHealthKit()
                            router.advance(.hkConnected)
                        }
                    }
                )
                .interactiveDismissDisabled()
            } else {
                OnboardingRevealFlow(onComplete: {
                    router.advance(.revealComplete)
                })
                .environmentObject(authManager)
                .environmentObject(syncManager)
                .interactiveDismissDisabled()
            }
        }
        // Service configuration + HK observer setup.
        // Runs once when MainTabView first mounts (covers both .bootstrapping and .active).
        // HK setup is guarded on onboardingPhase (not effectivePhase) so a mid-onboarding
        // 401 never fires system permission dialogs over the session-expired screen.
        .task {
            let client = GitHubAPIClient(authManager: authManager)
            syncManager.configure(
                apiClient: client,
                widgetStore: widgetStore,
                coachMessageClient: CoachMessageAPIClient(authManager: authManager)
            )
            workoutService.configure(apiClient: client)
            widgetStore.configure(apiClient: client, authManager: authManager)
            // A3: warm coach-chat's context cache as soon as the app is active with a valid
            // session, regardless of whether the athlete ever opens the Chat tab this launch.
            Task { await CoachChatAPIClient(authManager: authManager).prefetchContext() }
            guard router.onboardingPhase == .complete else { return }
            // B3: native onboarding is done, but that doesn't mean the First Session Protocol
            // chat intake is - live-check every launch until CoachSetupState is genuinely
            // complete (see CoachSetupBootstrap's doc comment for why this replaced the old
            // thread-existence heuristic). Only routes forward to Chat; never fights the athlete
            // back out of wherever they already navigated to - shouldOpenChatFirst() awaits a
            // real network call (up to 5s), so capture the tab as it was when the check started
            // and only apply the result if the athlete hasn't since tapped away on their own.
            let tabBeforeCheck = selectedTab
            if await CoachSetupBootstrap.shouldOpenChatFirst(authManager: authManager), selectedTab == tabBeforeCheck {
                selectedTab = .chat
            }
            syncManager.syncNotificationsEnabled = true
            try? await syncManager.requestAuthorization()
            await syncManager.requestNotificationPermission()
            syncManager.enableBackgroundDelivery()
            syncManager.setupWorkoutObserver()
        }
    }

    /// Keep every tab root alive so scroll position, navigation paths, and fetch state survive tab switches.
    @ViewBuilder
    private func tabRoot<Content: View>(_ tab: AppTab, @ViewBuilder content: () -> Content) -> some View {
        content()
            .opacity(selectedTab == tab ? 1 : 0)
            .allowsHitTesting(selectedTab == tab)
            .accessibilityHidden(selectedTab != tab)
            .zIndex(selectedTab == tab ? 1 : 0)
    }

    /// Tab bar ↔ Start CTA — crossfade + slight scale in the same dock slot.
    @ViewBuilder
    private var bottomDockContent: some View {
        ZStack {
            if bottomDock.mode == .tabs {
                WarmTabBar(selection: $selectedTab)
                    .transition(.dockMorph)
            }
            if bottomDock.mode == .startWorkout {
                WarmDockStartCTA()
                    .transition(.dockMorph)
            }
        }
        .animation(PremiumMotion.dock, value: bottomDock.mode)
    }
}

private extension AnyTransition {
    /// Shared dock swap — scale down slightly while fading out/in.
    static var dockMorph: AnyTransition {
        .scale(scale: 0.96).combined(with: .opacity)
    }
}

// MARK: - Warm tab bar (main app only — not compiled into WidgetKit extension)

private enum WarmDockMetrics {
    /// Icon row + inner pill padding (44 + 4×2); shared by tab bar and start CTA.
    static let pillHeight = WarmMainDockLayout.pillHeight
    static let horizontalPadding: CGFloat = 20
    static let topPadding = WarmMainDockLayout.topPadding
}

/// Floating icon dock — inset pill, sliding muted highlight, spring lift on the active icon.
private struct WarmTabBar: View {
    @Binding var selection: AppTab
    @Namespace private var tabIndicator
    @AppStorage("chatHasUnread") private var chatHasUnread = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                tabItem(tab)
            }
        }
        .padding(4)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(WarmInstrument.border.opacity(0.55), lineWidth: 1)
        )
        .shadow(color: WarmInstrument.cardShadow, radius: 14, x: 0, y: 5)
        .padding(.horizontal, WarmDockMetrics.horizontalPadding)
        .padding(.top, WarmDockMetrics.topPadding)
    }

    private func tabItem(_ tab: AppTab) -> some View {
        let selected = selection == tab
        return Button {
            guard selection != tab else { return }
            Haptics.tap()
            withAnimation(.spring(duration: 0.42, bounce: 0.22)) {
                selection = tab
            }
        } label: {
            ZStack {
                if selected {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(WarmInstrument.surfaceMuted)
                        .matchedGeometryEffect(id: "tabHighlight", in: tabIndicator)
                        .shadow(color: WarmInstrument.cardShadow.opacity(0.35), radius: 4, y: 2)
                }

                VStack(spacing: 2) {
                    Image(systemName: selected ? tab.filledIcon : tab.outlineIcon)
                        .font(.system(size: 18, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? WarmInstrument.ink : WarmInstrument.inkFaint)
                        .scaleEffect(selected ? 1.04 : 1)
                        .offset(y: selected ? -1 : 0)
                        .overlay(alignment: .topTrailing) {
                            if tab == .chat && chatHasUnread {
                                Circle()
                                    .fill(WarmInstrument.accent)
                                    .frame(width: 7, height: 7)
                                    .offset(x: 5, y: -2)
                            }
                        }

                    Text(tab.labelText)
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .tracking(0.4)
                        .foregroundStyle(selected ? WarmInstrument.ink : WarmInstrument.inkFaint)
                }
                .animation(.spring(duration: 0.38, bounce: 0.2), value: selected)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(TabBarPressStyle())
        .accessibilityLabel(tab.accessibilityLabel)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct TabBarPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(duration: 0.18, bounce: 0.08), value: configuration.isPressed)
    }
}

/// Terracotta start pill — occupies the same dock slot as `WarmTabBar`.
private struct WarmDockStartCTA: View {
    @EnvironmentObject private var bottomDock: BottomDockState

    var body: some View {
        Button {
            Haptics.tap()
            bottomDock.onStartWorkout?()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "play.fill")
                    .font(.system(size: 12, weight: .bold))
                Text("Start workout")
                    .font(.system(size: 15, weight: .bold))
                    .kerning(0.3)
            }
            .foregroundColor(WarmInstrument.paper)
            .frame(maxWidth: .infinity)
            .frame(height: WarmDockMetrics.pillHeight)
                .background(WorkoutTimerWarm.rust)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(WarmInstrument.border.opacity(0.35), lineWidth: 1)
                )
                .shadow(color: WorkoutTimerWarm.rust.opacity(0.28), radius: 8, y: 4)
        }
        .buttonStyle(TimerWarmPressStyle())
        .padding(.horizontal, WarmDockMetrics.horizontalPadding)
        .padding(.top, WarmDockMetrics.topPadding)
        .accessibilityLabel("Start workout")
    }
}
