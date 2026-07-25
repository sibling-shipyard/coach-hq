import SwiftUI

@main
struct CoachPhelpsApp: App {
    @StateObject private var authManager = GitHubAuthManager()
    @StateObject private var syncManager = HealthKitSyncManager()
    @StateObject private var workoutService = WorkoutService()
    @StateObject private var widgetStore = WidgetSnapshotStore()
    @AppStorage(Theme.darkModeKey) private var darkModeEnabled = false

    var body: some Scene {
        WindowGroup {
            Group {
                if authManager.isAuthenticated {
                    MainTabView()
                        .environmentObject(authManager)
                        .environmentObject(syncManager)
                        .environmentObject(workoutService)
                        .environmentObject(widgetStore)
                        .task {
                            let apiClient = GitHubAPIClient(authManager: authManager)
                            syncManager.configure(apiClient: apiClient, widgetStore: widgetStore)
                            workoutService.configure(apiClient: apiClient)
                            widgetStore.configure(apiClient: apiClient)
                            try? await syncManager.requestAuthorization()
                        }
                } else {
                    LoginView()
                        .environmentObject(authManager)
                }
            }
            .tint(Theme.accentGreen)
            .preferredColorScheme(darkModeEnabled ? .dark : .light)
        }
    }
}
