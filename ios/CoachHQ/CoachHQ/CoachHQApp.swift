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
    @StateObject private var router = AppRouter()

    init() {
        // UserDefaults is wiped on app deletion; Keychain is not. Clear any stale
        // keychain credentials on the first launch after a reinstall so the user
        // always starts from a clean LoginView rather than a broken session.
        let installedKey = "com.siblingshipyard.coachhq.hasLaunched"
        if !UserDefaults.standard.bool(forKey: installedKey) {
            GitHubAuthManager.clearKeychainOnFreshInstall()
            UserDefaults.standard.set(true, forKey: installedKey)
        }
    }
    @StateObject private var syncManager = HealthKitSyncManager()
    @StateObject private var workoutService = WorkoutService()
    @StateObject private var widgetStore = WidgetSnapshotStore()
    @StateObject private var bottomDock = BottomDockState()
    @ObservedObject private var webAuth = WebAuthPresenter.shared
    @AppStorage(Theme.darkModeKey) private var darkModeEnabled = false

    var body: some Scene {
        WindowGroup {
            Group {
                switch router.state {
                case .bootstrapping:
                    // Blank background while the stored token is verified — prevents the
                    // empty home skeleton from flashing before routing settles.
                    WarmInstrument.desk.ignoresSafeArea()
                case .active:
                    MainTabView()
                        .environmentObject(router.authManager)
                        .environmentObject(syncManager)
                        .environmentObject(workoutService)
                        .environmentObject(widgetStore)
                        .environmentObject(bottomDock)
                        .environmentObject(router)
                case .needsSetup(let login):
                    SetupView(login: login)
                        .environmentObject(router.authManager)
                case .unauthenticated:
                    LoginView()
                        .environmentObject(router.authManager)
                case .multipleReposGranted:
                    // Same view as .unauthenticated - LoginView reads
                    // authManager.multipleReposDetected itself and swaps in the blocked
                    // state (message + retry) instead of the sign-in button.
                    LoginView()
                        .environmentObject(router.authManager)
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
            .onChange(of: router.authManager.isAuthenticated) { _, isAuthenticated in
                // Sign-out must not leave a previous account's data on screen for the
                // next athlete to sign in on this device.
                if !isAuthenticated {
                    workoutService.reset()
                    widgetStore.reset()
                }
            }
        }
    }
}
