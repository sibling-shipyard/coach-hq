import SwiftUI

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
    case home, workouts, chat, more

    var outlineIcon: String {
        switch self {
        case .home: return "house"
        case .workouts: return "dumbbell"
        case .chat: return "bubble.left.and.bubble.right"
        case .more: return "ellipsis.circle"
        }
    }

    var filledIcon: String {
        switch self {
        case .home: return "house.fill"
        case .workouts: return "dumbbell.fill"
        case .chat: return "bubble.left.and.bubble.right.fill"
        case .more: return "ellipsis.circle.fill"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .home: return "Home"
        case .workouts: return "Workouts"
        case .chat: return "Coach Chat"
        case .more: return "More"
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
    @State private var didSetInitialTab = false

    var body: some View {
        ZStack(alignment: .bottom) {
            ZStack {
                tabRoot(.home) {
                    WarmInstrumentHomeView()
                }
                tabRoot(.workouts) {
                    WorkoutListView()
                        .environmentObject(workoutService)
                }
                tabRoot(.chat) {
                    CoachChatView()
                        .environmentObject(authManager)
                }
                tabRoot(.more) {
                    SettingsView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if !tabBarHidden && !authManager.sessionExpired {
                bottomDockContent
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
        .task(id: initialTabResolveToken) {
            guard !didSetInitialTab else { return }
            guard authManager.isSessionReady else { return }
            if await CoachSetupBootstrap.shouldOpenChatFirst(authManager: authManager) {
                selectedTab = .chat
            }
            didSetInitialTab = true
        }
    }

    /// Re-runs initial tab resolution once session + repo are ready (not on every tab switch).
    private var initialTabResolveToken: String {
        [
            authManager.isSessionReady ? "ready" : "boot",
            authManager.repoFullName ?? "",
        ].joined(separator: "|")
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

                Image(systemName: selected ? tab.filledIcon : tab.outlineIcon)
                    .font(.system(size: 20, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? WarmInstrument.ink : WarmInstrument.inkFaint)
                    .scaleEffect(selected ? 1.05 : 1)
                    .offset(y: selected ? -1.5 : 0)
                    .animation(.spring(duration: 0.38, bounce: 0.2), value: selected)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 44)
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
            Text("▶ Start workout")
                .font(.system(size: 15, weight: .bold))
                .kerning(0.3)
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
