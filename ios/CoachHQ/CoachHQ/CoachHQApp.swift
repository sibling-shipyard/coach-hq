import SwiftUI
import UserNotifications

// MARK: - Notification delegate — routes "navigateTo=chat" taps to MainTabView

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        DiagnosticsManager.configure()
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
    @State private var markerReady: Bool

    init() {
        _markerReady = State(initialValue: Self.prepareInstall() != .unavailable)
    }

    private static func prepareInstall() -> InstallMarker.Outcome {
        InstallMarker.prepare(at: InstallMarker.defaultURL, defaults: .standard) {
            if GitHubAuthManager.clearKeychainOnFreshInstall() {
                // AppDelegate configures Sentry after this initializer; report the wipe on first paint.
                UserDefaults.standard.set(true, forKey: InstallMarker.pendingWipeKey)
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            if markerReady {
                CoachHQRootView()
            } else {
                VStack(spacing: 16) {
                    Text("Couldn't prepare local storage")
                        .font(.system(size: 20, weight: .semibold))
                    Text("Try again before signing in.")
                        .font(.system(size: 14))
                    WarmPrimary(title: "Try again", fill: Theme.ink) {
                        markerReady = Self.prepareInstall() != .unavailable
                    }
                }
                .foregroundColor(WarmInstrument.ink)
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(WarmInstrument.desk.ignoresSafeArea())
            }
        }
    }
}

private struct CoachHQRootView: View {
    @StateObject private var router = AppRouter()
    @StateObject private var syncManager = HealthKitSyncManager()
    @StateObject private var workoutService = WorkoutService()
    @StateObject private var widgetStore = WidgetSnapshotStore()
    @StateObject private var allActivitiesStore = AllActivitiesStore()
    @StateObject private var bottomDock = BottomDockState()
    @ObservedObject private var webAuth = WebAuthPresenter.shared
    @AppStorage(Theme.darkModeKey) private var darkModeEnabled = false
    @AppStorage("debugWarmLoaderGallery") private var showLoaderGallery = false

    var body: some View {
        Group {
            switch router.state {
            case .bootstrapping:
                // Same centered Wave as Home's first paint — blank desk was a flash.
                WarmPageWait()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(WarmInstrument.desk.ignoresSafeArea())
            case .sessionUnavailable:
                SessionRetryView(authManager: router.authManager)
            case .active:
                MainTabView()
                    .environmentObject(router.authManager)
                    .environmentObject(syncManager)
                    .environmentObject(workoutService)
                    .environmentObject(widgetStore)
                    .environmentObject(allActivitiesStore)
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
        .overlay {
            if showLoaderGallery {
                WarmLoaderGalleryView()
                    .zIndex(200)
            }
        }
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
                DiagnosticsManager.setAthlete(repoFullName: nil)
                workoutService.reset()
                widgetStore.reset()
                allActivitiesStore.reset()
                HRStreamCache.reset()
                CoachMessageRoute.clear()
            }
        }
        .onAppear {
            if UserDefaults.standard.bool(forKey: InstallMarker.pendingWipeKey) {
                DiagnosticsManager.capture(
                    message: "iOS credentials cleared on first launch",
                    severity: .warning,
                    operation: "github.auth.sign_out",
                    operationID: UUID(),
                    metadata: ["reason": "fresh_install_wipe"],
                    tags: ["reason": "fresh_install_wipe"]
                )
                UserDefaults.standard.removeObject(forKey: InstallMarker.pendingWipeKey)
            }
            // Lets AppRouter.checkAccountSwitch() reset these on an account switch
            // (not just the explicit sign-out path above).
            router.bindAccountScopedServices(
                workoutService: workoutService,
                widgetStore: widgetStore,
                allActivitiesStore: allActivitiesStore
            )
        }
    }
}

enum InstallMarker {
    enum Outcome: Equatable { case existing, migrated, freshInstall, unavailable }
    static let legacyKey = "com.siblingshipyard.coachhq.hasLaunched"
    static let pendingWipeKey = "com.siblingshipyard.coachhq.pendingFreshInstallWipe"

    static var defaultURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("install-marker", isDirectory: false)
    }

    static func prepare(at url: URL, defaults: UserDefaults, onFreshInstall: () -> Void) -> Outcome {
        if FileManager.default.fileExists(atPath: url.path) { return .existing }
        let isMigration = defaults.bool(forKey: legacyKey)
        if !isMigration { onFreshInstall() }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data().write(to: url, options: .atomic)
        } catch {
            return .unavailable
        }
        if isMigration { return .migrated }
        defaults.set(true, forKey: legacyKey)
        return .freshInstall
    }
}
