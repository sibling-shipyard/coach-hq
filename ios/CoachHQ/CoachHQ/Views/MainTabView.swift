import SwiftUI

enum AppTab: Hashable {
    case home, sync, activities, timer, settings
}

struct MainTabView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var workoutService: WorkoutService
    @State private var selectedTab: AppTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            WarmInstrumentHomeView(onOpenActivities: { selectedTab = .activities })
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }
                .tag(AppTab.home)

            SyncStatusView()
                .tabItem {
                    Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                }
                .tag(AppTab.sync)

            ActivityListView()
                .tabItem {
                    Label("Activities", systemImage: "chart.bar.doc.horizontal")
                }
                .tag(AppTab.activities)

            WorkoutListView()
                .environmentObject(workoutService)
                .tabItem {
                    Label("Timer", systemImage: "timer")
                }
                .tag(AppTab.timer)

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
                .tag(AppTab.settings)
        }
        .tint(Theme.accentGreen)
    }
}
