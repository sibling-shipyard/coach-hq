import SwiftUI

@main
struct CoachHQApp: App {
    @StateObject private var authManager = GitHubAuthManager()
    @StateObject private var syncManager = HealthKitSyncManager()
    @StateObject private var workoutService = WorkoutService()
    @StateObject private var widgetStore = WidgetSnapshotStore()
    @StateObject private var bottomDock = BottomDockState()
    @AppStorage(Theme.darkModeKey) private var darkModeEnabled = false

    var body: some Scene {
        WindowGroup {
            Group {
                // selectedRepo != nil: repo already known. !isSessionReady: still resolving
                // (cold launch / bootstrapSession in flight) - let MainTabView's own
                // isSessionReady gating show the loading state, same as before this check
                // existed. Only once isSessionReady flips true with no repo resolved does
                // GitHubAuthManager set pendingSetupLogin, which routes to SetupView below
                // instead of a MainTabView with nothing to show.
                if authManager.isAuthenticated && (authManager.selectedRepo != nil || !authManager.isSessionReady) {
                    MainTabView()
                        .environmentObject(authManager)
                        .environmentObject(syncManager)
                        .environmentObject(workoutService)
                        .environmentObject(widgetStore)
                        .environmentObject(bottomDock)
                        .task {
                            let apiClient = GitHubAPIClient(authManager: authManager)
                            syncManager.configure(apiClient: apiClient, widgetStore: widgetStore)
                            workoutService.configure(apiClient: apiClient)
                            widgetStore.configure(apiClient: apiClient)
                            try? await syncManager.requestAuthorization()
                        }
                } else if authManager.pendingSetupLogin != nil {
                    SetupView()
                        .environmentObject(authManager)
                } else {
                    LoginView()
                        .environmentObject(authManager)
                }
            }
            .tint(Theme.ink)
            .preferredColorScheme(darkModeEnabled ? .dark : .light)
        }
    }
}
