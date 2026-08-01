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

struct MainTabView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var workoutService: WorkoutService
    @EnvironmentObject var bottomDock: BottomDockState
    @State private var selectedTab: AppTab = .home
    @State private var tabBarHidden = false
    @AppStorage("chatHasUnread") private var chatHasUnread = false
    @AppStorage("pendingChatNavigation") private var pendingChatNavigation = false
    @AppStorage("personalizeShown") private var personalizeShown = false
    // Read from UserDefaults at init so the overlay is present on the very first frame.
    @State private var welcomeVisible = !UserDefaults.standard.bool(forKey: "personalizeShown")

    var body: some View {
        ZStack(alignment: .bottom) {
            ZStack {
                tabRoot(.home) {
                    WarmInstrumentHomeView()
                }
                tabRoot(.chat) {
                    CoachChatView()
                        .environmentObject(authManager)
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

            if !tabBarHidden && !authManager.sessionExpired {
                bottomDockContent
            }

            // First-launch splash — shows logo + "Coach HQ" while either tab loads underneath
            // (selectedTab defaults to .home, but shouldOpenChatFirst() below may switch it to
            // .chat before the splash fades - not always Chat loading under here anymore).
            // On exit: lands on Chat for a genuinely new athlete (Coach's intro is the first
            // thing they see) or Home for an existing athlete reopening the app fresh (new
            // device/reinstall) who already has real chat history - shouldOpenChatFirst() makes
            // that call. Splash doesn't fade until the decision has actually landed, so there's
            // no visible flash of the wrong tab underneath.
            if welcomeVisible {
                SplashView {
                    personalizeShown = true
                    Task {
                        selectedTab = await CoachSetupBootstrap.shouldOpenChatFirst(authManager: authManager) ? .chat : .home
                        try? await Task.sleep(for: .seconds(0.5))
                        welcomeVisible = false
                    }
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
        .onPreferenceChange(TabBarHiddenPreferenceKey.self) { tabBarHidden = $0 }
        .animation(PremiumMotion.dock, value: tabBarHidden)
        .background(WarmInstrument.desk.ignoresSafeArea())
        .onAppear {
            if pendingChatNavigation {
                pendingChatNavigation = false
                selectedTab = .chat
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToChat)) { _ in
            withAnimation(PremiumMotion.state) { selectedTab = .chat }
        }
        .onReceive(NotificationCenter.default.publisher(for: .navigateToHome)) { _ in
            withAnimation(PremiumMotion.state) { selectedTab = .home }
        }
        .onChange(of: selectedTab) { _, newTab in
            if newTab == .chat { chatHasUnread = false }
        }
        .onChange(of: chatHasUnread) { _, hasUnread in
            if hasUnread && selectedTab == .chat { chatHasUnread = false }
            Task { try? await UNUserNotificationCenter.current().setBadgeCount(hasUnread ? 1 : 0) }
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
