import Foundation
import Combine

// MARK: - AppState

enum AppState: Equatable {
    case bootstrapping
    case unauthenticated
    case needsSetup(login: String)
    case multipleReposGranted
    case active
}

// MARK: - OnboardingPhase

enum OnboardingPhase: Int {
    case notStarted = 0
    case hkPrompt   = 1
    case reveal     = 2
    case complete   = 3
}

// MARK: - OnboardingEvent

enum OnboardingEvent {
    case splashDismissed
    case hkConnected
    case revealComplete
}

// MARK: - AppRouter

/// Derives app routing state from GitHubAuthManager's published properties and owns
/// the persisted OnboardingPhase. CoachHQApp switches on router.state; MainTabView
/// renders onboarding overlays via router.effectivePhase.
@MainActor
final class AppRouter: ObservableObject {
    @Published private(set) var state: AppState = .bootstrapping { didSet { TimelineBuffer.shared.addEvent("AppRouter state: \(state)") } }
    @Published private(set) var onboardingPhase: OnboardingPhase = .notStarted

    let authManager: GitHubAuthManager

    // Account-scoped services reset from `checkAccountSwitch()` when the signed-in login
    // changes. Weak: these are app-lifetime `@StateObject`s owned by `CoachHQApp`, bound in
    // once via `bindAccountScopedServices` shortly after launch.
    private weak var workoutService: WorkoutService?
    private weak var widgetStore: WidgetSnapshotStore?

    /// Called once from `CoachHQApp` so `checkAccountSwitch()` can reset these stores when
    /// it detects a different GitHub login signed in — not just on the explicit sign-out path.
    func bindAccountScopedServices(workoutService: WorkoutService, widgetStore: WidgetSnapshotStore) {
        self.workoutService = workoutService
        self.widgetStore = widgetStore
    }

    /// Returns .complete when sessionExpired so fullScreenCovers never render above the
    /// session-expired overlay. Use for overlay rendering only — not for the HK-setup
    /// .task guard (which uses onboardingPhase directly to avoid firing system dialogs
    /// over the expired screen).
    var effectivePhase: OnboardingPhase {
        authManager.sessionExpired ? .complete : onboardingPhase
    }

    private var cancellables = Set<AnyCancellable>()
    private let phaseKey     = "onboardingPhase"
    private let lastLoginKey = "lastOnboardingLogin"
    // True once this session has passed through .needsSetup — used to reset the onboarding
    // phase when state first reaches .active so the intro flow always shows after setup.
    private var hasBeenInSetup = false

    init() {
        authManager = GitHubAuthManager()
        loadPhase()
        observeAuth()
        deriveState()
    }

    // MARK: - Phase persistence

    private func loadPhase() {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: phaseKey) != nil {
            onboardingPhase = OnboardingPhase(rawValue: defaults.integer(forKey: phaseKey)) ?? .notStarted
        } else {
            let migrated = migrateFromLegacyKeys(defaults: defaults)
            onboardingPhase = migrated
            defaults.set(migrated.rawValue, forKey: phaseKey)
            // lastOnboardingLogin intentionally not written here — user not yet resolved.
            // It is written when authManager.user first resolves (see checkAccountSwitch).
        }
    }

    /// Reads the three legacy AppStorage onboarding keys, evaluates top-to-bottom
    /// (first match wins — a mid-onboarding user can have multiple keys true), and
    /// deletes all three regardless of which matched.
    private func migrateFromLegacyKeys(defaults: UserDefaults) -> OnboardingPhase {
        defer {
            defaults.removeObject(forKey: "onboardingRevealShown")
            defaults.removeObject(forKey: "hkPrePromptShown")
            defaults.removeObject(forKey: "personalizeShown")
        }
        if defaults.bool(forKey: "onboardingRevealShown") { return .complete }
        if defaults.bool(forKey: "hkPrePromptShown")      { return .complete }
        if defaults.bool(forKey: "personalizeShown")       { return .hkPrompt }
        return .notStarted
    }

    // MARK: - Auth observation

    private func observeAuth() {
        // Re-derive AppState whenever any routing-relevant auth property changes.
        Publishers.CombineLatest4(
            authManager.$isSessionReady,
            authManager.$isAuthenticated,
            authManager.$selectedRepo,
            authManager.$pendingSetupLogin
        )
        .receive(on: DispatchQueue.main)
        .sink { [weak self] _, _, _, _ in self?.deriveState() }
        .store(in: &cancellables)

        authManager.$multipleReposDetected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.deriveState() }
            .store(in: &cancellables)

        // Account-switch check — runs each time session becomes ready (false → true).
        authManager.$isSessionReady
            .filter { $0 }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.checkAccountSwitch(user: self.authManager.user)
            }
            .store(in: &cancellables)

        // effectivePhase depends on sessionExpired — push objectWillChange so views
        // that read effectivePhase re-render when the expired flag flips.
        authManager.$sessionExpired
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.objectWillChange.send() }
            .store(in: &cancellables)
    }

    private func deriveState() {
        // Capture setup-visited flag before any state mutation.
        if case .needsSetup = state { hasBeenInSetup = true }
        let wasActive = state == .active

        guard authManager.isSessionReady else {
            state = .bootstrapping
            return
        }
        // pendingSetupLogin is set by the needs_setup=1 callback branch, which does NOT set
        // isAuthenticated — check it before the auth guard so SetupView renders correctly.
        if let login = authManager.pendingSetupLogin { state = .needsSetup(login: login); return }
        // 2+ repos granted (ADR 0019) - block before the auth guard, same as pendingSetupLogin,
        // since isAuthenticated is true here (the account does have a working repo, just extras).
        if authManager.multipleReposDetected { state = .multipleReposGranted; return }
        guard authManager.isAuthenticated else { state = .unauthenticated; return }
        if authManager.selectedRepo != nil {
            state = .active
            // After setup completion, always reset the onboarding phase to .notStarted so the
            // user sees the full Coach intro flow, regardless of any prior run that left the
            // phase at .complete (checkAccountSwitch won't reset for the same login).
            // Published properties are set sequentially so deriveState fires multiple times —
            // hasBeenInSetup captures the setup context across those intermediate calls.
            if !wasActive && hasBeenInSetup {
                persistPhase(.notStarted)
                hasBeenInSetup = false
            }
            return
        }
        // isSessionReady + isAuthenticated + no repo + no pendingSetupLogin:
        // zombie-token path — bootstrapSession() should have called signOut(), but guard here.
        state = .unauthenticated
    }

    // MARK: - Account switch

    private func checkAccountSwitch(user: GitHubUser?) {
        guard authManager.isAuthenticated, let login = user?.login else { return }
        let defaults = UserDefaults.standard
        let stored = defaults.string(forKey: lastLoginKey)
        if stored == nil {
            // Absent: first resolve after install or migration — adopt silently, never reset.
            defaults.set(login, forKey: lastLoginKey)
            Task { await skipOnboardingIfAlreadyComplete() }
        } else if stored != login {
            // Different account — reset onboarding so the new user gets the full flow, and
            // drop any previous account's cached workouts/Home data so it can't flash on
            // screen before the new account's fetch lands.
            persistPhase(.notStarted)
            defaults.set(false, forKey: "hkAuthorizationGranted")
            defaults.set(login, forKey: lastLoginKey)
            workoutService?.reset()
            widgetStore?.reset()
        }
        // Same login — no action.
    }

    /// New device or reinstall: `onboardingPhase` defaults to `.notStarted` locally, but the
    /// athlete may have already finished First Session Protocol elsewhere. Checks the fast
    /// local Keychain flag first (survives same-device reinstall), then falls back to the
    /// server (same `/api/coach-chat-profile-status` signal `CoachSetupBootstrap` uses) for a
    /// genuinely new device, so a returning athlete never re-runs the name/HK/reveal onboarding.
    private func skipOnboardingIfAlreadyComplete() async {
        guard onboardingPhase == .notStarted else { return }
        guard let repo = authManager.repoFullName else { return }
        if CoachSetupState.isComplete(repoFullName: repo) {
            persistPhase(.complete)
            return
        }
        let client = CoachChatAPIClient(authManager: authManager)
        if let complete = try? await client.profileStatus(), complete {
            CoachSetupState.markComplete(repoFullName: repo)
            persistPhase(.complete)
        }
    }

    // MARK: - Onboarding events

    func advance(_ event: OnboardingEvent) {
        switch event {
        case .splashDismissed: persistPhase(.hkPrompt)
        case .hkConnected:     persistPhase(.reveal)
        case .revealComplete:  persistPhase(.complete)
        }
    }

    private func persistPhase(_ phase: OnboardingPhase) {
        onboardingPhase = phase
        UserDefaults.standard.set(phase.rawValue, forKey: phaseKey)
    }
}
