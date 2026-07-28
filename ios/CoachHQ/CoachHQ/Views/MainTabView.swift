import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @EnvironmentObject var syncManager: HealthKitSyncManager
    @EnvironmentObject var workoutService: WorkoutService

    var body: some View {
        TabView {
            WarmInstrumentHomeView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            SyncStatusView()
                .tabItem {
                    Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                }

            ActivityListView()
                .tabItem {
                    Label("Activities", systemImage: "chart.bar.doc.horizontal")
                }

            WorkoutListView()
                .environmentObject(workoutService)
                .tabItem {
                    Label("Timer", systemImage: "timer")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
        }
        .tint(Theme.accentGreen)
    }
}
