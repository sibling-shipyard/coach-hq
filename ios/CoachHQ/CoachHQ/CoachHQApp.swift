import Sentry
import SwiftUI
import UserNotifications

// MARK: - Notification delegate — routes "navigateTo=chat" taps to MainTabView

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self

SentrySDK.start { options in
    options.dsn = Secrets.sentryDSN
    options.beforeSend = { event in
        if let request = event.request, let headers = request.headers as? [String: String] {
            var newHeaders = headers
            let keysToScrub = ["authorization", "cookie", "set-cookie", "x-github-token", "x-session-token"]
            for key in newHeaders.keys {
                if keysToScrub.contains(key.lowercased()) {
                    newHeaders[key] = "[Filtered]"
                }
            }
            event.request?.headers = newHeaders
        }
        
        // Deep scrub strings in extras and tags
        func scrubString(_ str: String) -> String {
            var result = str
            let patterns = [
                "ghp_[A-Za-z0-9_]{36,}",
                "AIza[0-9A-Za-z\-_]{35}",
                "Bearer eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_=]*",
                "eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_=]*"
            ]
            for pattern in patterns {
                if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
                    result = regex.stringByReplacingMatches(in: result, options: [], range: NSRange(location: 0, length: result.utf16.count), withTemplate: "[Filtered]")
                }
            }
            return result
        }
        
        if let extras = event.extra {
            var newExtras = extras
            for (k, v) in extras {
                if let str = v as? String {
                    newExtras[k] = scrubString(str)
                }
            }
            event.extra = newExtras
        }
        
        if let message = event.message {
            event.message = SentryMessage(formatted: scrubString(message.formatted))
        }
        
        if let breadcrumbs = event.breadcrumbs {
    for crumb in breadcrumbs {
        if let message = crumb.message {
            crumb.message = scrubString(message)
        }
        if let data = crumb.data {
            var newData = data
            for (k, v) in data {
                if let str = v as? String {
                    newData[k] = scrubString(str)
                }
            }
            crumb.data = newData
        }
    }
}

                return event
    }
}

        return true
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        if (userInfo["navigateTo"] as? String) == "chat" {
            let route = CoachMessageRoute(userInfo: userInfo)
            if let route {
                route.persist()
            } else {
                CoachMessageRoute.clear()
            }
            // Store flag so MainTabView can read it on appear — handles cold-launch case
            // where MainTabView isn't mounted when this fires.
            UserDefaults.standard.set(true, forKey: "pendingChatNavigation")
            NotificationCenter.default.post(name: .navigateToChat, object: route)
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
            .onOpenURL { url in
                // Catch coachhq:// callbacks that reach the app via the OS URL scheme
                // handler instead of being intercepted inside WKWebView (e.g. when the
                // server redirects to coachhq:// via a context the WebView can't catch).
                guard url.scheme?.lowercased() == "coachhq" else { return }
                WebAuthPresenter.shared.complete(with: url)
            }
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
                    CoachMessageRoute.clear()
                }
            }
            .onAppear {
                // Lets AppRouter.checkAccountSwitch() reset these on an account switch
                // (not just the explicit sign-out path above).
                router.bindAccountScopedServices(workoutService: workoutService, widgetStore: widgetStore)
            }
        }
    }
}
