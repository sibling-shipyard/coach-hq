import SwiftUI

enum AppTab: Hashable {
    case home, workouts, more
}

struct MainTabView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var workoutService: WorkoutService
    @State private var selectedTab: AppTab = .home

    var body: some View {
        VStack(spacing: 0) {
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

            WarmTabBar(selection: $selectedTab)
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
    }
}

// MARK: - Warm tab bar (main app only — not compiled into WidgetKit extension)

/// Minimal icon-only bottom nav — paper surface, hairline top rule, ink selected / faint idle.
/// Terracotta stays off chrome; reserved for load CTAs inside screens.
private struct WarmTabBar: View {
    @Binding var selection: AppTab

    var body: some View {
        HStack(spacing: 0) {
            tabItem(.home, outline: "house", filled: "house.fill", label: "Home")
            tabItem(.workouts, outline: "dumbbell", filled: "dumbbell.fill", label: "Workouts")
            tabItem(.more, outline: "ellipsis.circle", filled: "ellipsis.circle.fill", label: "More")
        }
        .padding(.horizontal, 28)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .background(WarmInstrument.paper)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(WarmInstrument.headerRule)
                .frame(height: 1)
        }
    }

    private func tabItem(_ tab: AppTab, outline: String, filled: String, label: String) -> some View {
        let selected = selection == tab
        return Button {
            guard selection != tab else { return }
            Haptics.tap()
            withAnimation(.spring(duration: 0.2, bounce: 0)) {
                selection = tab
            }
        } label: {
            Image(systemName: selected ? filled : outline)
                .font(.system(size: 21, weight: selected ? .semibold : .regular))
                .foregroundColor(selected ? WarmInstrument.ink : WarmInstrument.inkFaint)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
