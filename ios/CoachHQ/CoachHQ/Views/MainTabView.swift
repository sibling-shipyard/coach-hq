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
