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
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear.frame(height: WarmTabBarMetrics.contentInset)
        }
        .overlay(alignment: .bottom) {
            ZStack(alignment: .bottom) {
                WarmTabBarScrollFade()
                    .allowsHitTesting(false)

                WarmTabBar(selection: $selectedTab)
                    .padding(.horizontal, 20)
                    .padding(.bottom, WarmTabBarMetrics.bottomInset)
            }
            .ignoresSafeArea(edges: .bottom)
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
    }
}

// MARK: - Warm tab bar (main app only — not compiled into WidgetKit extension)

private enum WarmTabBarMetrics {
    static let pillHeight: CGFloat = 52
    static let fadeHeight: CGFloat = 56
    /// Sits the dock closer to the physical bottom — just above the home indicator.
    static let bottomInset: CGFloat = 2
    static var contentInset: CGFloat { pillHeight + bottomInset + 6 }
}

/// Desk fade so widgets dissolve before the dock; softer with glass since content shows through.
private struct WarmTabBarScrollFade: View {
    var body: some View {
        VStack(spacing: 0) {
            LinearGradient(
                stops: [
                    .init(color: WarmInstrument.desk.opacity(0), location: 0),
                    .init(color: WarmInstrument.desk.opacity(0.35), location: 0.42),
                    .init(color: WarmInstrument.desk.opacity(0.78), location: 0.78),
                    .init(color: WarmInstrument.desk.opacity(0.94), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: WarmTabBarMetrics.fadeHeight)

            Color.clear.frame(height: WarmTabBarMetrics.pillHeight + WarmTabBarMetrics.bottomInset)
        }
    }
}

/// Floating glass dock — warm-tinted liquid glass over scroll content, spring selection pill.
private struct WarmTabBar: View {
    @Binding var selection: AppTab
    @Namespace private var tabIndicator

    private let pillShape = RoundedRectangle(cornerRadius: 22, style: .continuous)
    private let itemShape = RoundedRectangle(cornerRadius: 16, style: .continuous)

    var body: some View {
        HStack(spacing: 4) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                tabItem(tab)
            }
        }
        .padding(4)
        .glassEffect(
            .regular.tint(WarmInstrument.paper.opacity(0.78)).interactive(),
            in: pillShape
        )
        .overlay(
            pillShape.strokeBorder(WarmInstrument.border.opacity(0.35), lineWidth: 0.75)
        )
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
                    itemShape
                        .glassEffect(
                            .regular.tint(WarmInstrument.surfaceMuted.opacity(0.92)).interactive(),
                            in: itemShape
                        )
                        .matchedGeometryEffect(id: "tabHighlight", in: tabIndicator)
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
            .contentShape(itemShape)
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
