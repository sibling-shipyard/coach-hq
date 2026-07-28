import SwiftUI

enum AppTab: Hashable, CaseIterable {
    case home, workouts, more

    var outlineIcon: String {
        switch self {
        case .home: return "house"
        case .workouts: return "dumbbell"
        case .more: return "ellipsis.circle"
        }
    }

    var filledIcon: String {
        switch self {
        case .home: return "house.fill"
        case .workouts: return "dumbbell.fill"
        case .more: return "ellipsis.circle.fill"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .home: return "Home"
        case .workouts: return "Workouts"
        case .more: return "More"
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var workoutService: WorkoutService
    @State private var selectedTab: AppTab = .home

    var body: some View {
        Group {
            switch selectedTab {
            case .home:
                WarmInstrumentHomeView()
            case .workouts:
                WorkoutListView()
                    .environmentObject(workoutService)
            case .more:
                SettingsView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.spring(duration: 0.38, bounce: 0.12), value: selectedTab)
        .environment(\.warmTabBarScrollClearance, WarmTabBarMetrics.scrollBottomPadding)
        .overlay(alignment: .bottom) {
            WarmTabBarScrollFade()
                .allowsHitTesting(false)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            WarmTabBar(selection: $selectedTab)
                .padding(.bottom, WarmTabBarMetrics.bottomInset)
                .background(WarmInstrument.desk.ignoresSafeArea(edges: .bottom))
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
    }
}

// MARK: - Warm tab bar (main app only — not compiled into WidgetKit extension)

private enum WarmTabBarMetrics {
    /// Icon row + inner pill padding (44 + 4×2).
    static let pillHeight: CGFloat = 52
    /// How far the desk fade extends above the pill.
    static let fadeHeight: CGFloat = 56
    /// Gap above the home indicator — pill sits in the safe-area band.
    static let bottomInset: CGFloat = 4
    /// Extra scroll padding so the last row clears the fade + dock.
    static let scrollBreathing: CGFloat = 16
    static var scrollBottomPadding: CGFloat {
        pillHeight + fadeHeight + bottomInset + scrollBreathing
    }
}

/// Desk-color fade so scroll content dissolves before the floating dock — not a hard clip.
private struct WarmTabBarScrollFade: View {
    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(
                stops: [
                    .init(color: WarmInstrument.desk.opacity(0), location: 0),
                    .init(color: WarmInstrument.desk.opacity(0.45), location: 0.38),
                    .init(color: WarmInstrument.desk.opacity(0.88), location: 0.72),
                    .init(color: WarmInstrument.desk, location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: WarmTabBarMetrics.fadeHeight)

            Color.clear.frame(height: WarmTabBarMetrics.pillHeight)
        }
    }
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
        .padding(.horizontal, 20)
        .padding(.top, 2)
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

// MARK: - Scroll clearance (tab-root screens pad content by this amount)

struct WarmTabBarScrollClearanceKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    var warmTabBarScrollClearance: CGFloat {
        get { self[WarmTabBarScrollClearanceKey.self] }
        set { self[WarmTabBarScrollClearanceKey.self] = newValue }
    }
}
