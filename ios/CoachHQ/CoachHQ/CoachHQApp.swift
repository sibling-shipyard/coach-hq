import SwiftUI
import UserNotifications

// MARK: - Notification delegate — routes "navigateTo=chat" taps to MainTabView

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if (response.notification.request.content.userInfo["navigateTo"] as? String) == "chat" {
            // Store flag so MainTabView can read it on appear — handles cold-launch case
            // where MainTabView isn't mounted when this fires.
            UserDefaults.standard.set(true, forKey: "pendingChatNavigation")
            NotificationCenter.default.post(name: .navigateToChat, object: nil)
        }
        completionHandler()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}

@main
struct CoachHQApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var authManager = GitHubAuthManager()
    @StateObject private var syncManager = HealthKitSyncManager()
    @StateObject private var workoutService = WorkoutService()
    @StateObject private var widgetStore = WidgetSnapshotStore()
    @StateObject private var bottomDock = BottomDockState()
    @ObservedObject private var webAuth = WebAuthPresenter.shared
    @AppStorage(Theme.darkModeKey) private var darkModeEnabled = false
    @AppStorage("hkPrePromptShown") private var hkPrePromptShown = false
    @State private var showHKPrePrompt = false

    var body: some Scene {
        WindowGroup {
            Group {
                // !isSessionReady: still resolving (cold launch) - let MainTabView's own
                // gating show the loading state. Once isSessionReady flips true with no repo
                // resolved, pendingSetupLogin routes to SetupView instead.
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
                            if hkPrePromptShown {
                                try? await syncManager.requestAuthorization()
                                await syncManager.requestNotificationPermission()
                                syncManager.enableBackgroundDelivery()
                                syncManager.setupWorkoutObserver()
                            } else {
                                showHKPrePrompt = true
                            }
                        }
                        .fullScreenCover(isPresented: $showHKPrePrompt) {
                            HealthKitPrePromptView(
                                onConnect: {
                                    showHKPrePrompt = false
                                    hkPrePromptShown = true
                                    Task {
                                        try? await syncManager.requestAuthorization()
                                        await syncManager.requestNotificationPermission()
                                        syncManager.enableBackgroundDelivery()
                                        syncManager.setupWorkoutObserver()
                                    }
                                },
                                onSkip: {
                                    showHKPrePrompt = false
                                    hkPrePromptShown = true
                                }
                            )
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
            .sheet(isPresented: webAuth.isPresentedBinding) {
                if let url = webAuth.currentURL {
                    InAppAuthWebView(
                        url: url,
                        mode: webAuth.mode,
                        onCallback: { webAuth.complete(with: $0) },
                        onCancel: { webAuth.cancel() },
                        onDismissBrowse: { webAuth.dismissBrowse() }
                    )
                }
            }
        }
    }
}
