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
        ZStack(alignment: .bottom) {
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

            WarmTabBar(selection: $selectedTab)
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
    }
}

// MARK: - Warm tab bar (main app only — not compiled into WidgetKit extension)

/// Fitness-style translucent bottom bar — content scrolls beneath frosted warm glass.
private struct WarmTabBar: View {
    @Binding var selection: AppTab
    @Namespace private var tabIndicator

    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(WarmInstrument.headerRule.opacity(0.45))
                .frame(height: 0.5)

            HStack(spacing: 0) {
                ForEach(AppTab.allCases, id: \.self) { tab in
                    tabItem(tab)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 6)
        }
        .background { tabBarMaterial }
        .ignoresSafeArea(edges: .bottom)
    }

    private var tabBarMaterial: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Rectangle().fill(WarmInstrument.paper.opacity(0.34))
        }
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
                    Capsule(style: .continuous)
                        .fill(WarmInstrument.surfaceMuted.opacity(0.72))
                        .matchedGeometryEffect(id: "tabHighlight", in: tabIndicator)
                }

                Image(systemName: selected ? tab.filledIcon : tab.outlineIcon)
                    .font(.system(size: 21, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? WarmInstrument.ink : WarmInstrument.inkFaint)
                    .scaleEffect(selected ? 1.04 : 1)
                    .animation(.spring(duration: 0.38, bounce: 0.2), value: selected)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .contentShape(Capsule())
        }
        .buttonStyle(TabBarPressStyle())
        .accessibilityLabel(tab.accessibilityLabel)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

private struct TabBarPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .opacity(configuration.isPressed ? 0.72 : 1)
            .animation(.spring(duration: 0.18, bounce: 0.08), value: configuration.isPressed)
    }
}
