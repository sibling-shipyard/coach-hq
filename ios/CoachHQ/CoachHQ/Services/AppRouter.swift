import Foundation
import Combine

// MARK: - AppState

enum AppState: Equatable {
    case bootstrapping
    case unauthenticated
    case needsSetup(login: String)
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
    @Published private(set) var state: AppState = .bootstrapping
    @Published private(set) var onboardingPhase: OnboardingPhase = .notStarted

    let authManager: GitHubAuthManager

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
        guard authManager.isSessionReady else {
            state = .bootstrapping
            return
        }
        // pendingSetupLogin is set by the needs_setup=1 callback branch, which does NOT set
        // isAuthenticated — check it before the auth guard so SetupView renders correctly.
        if let login = authManager.pendingSetupLogin { state = .needsSetup(login: login); return }
        guard authManager.isAuthenticated else { state = .unauthenticated; return }
        if authManager.selectedRepo != nil {
            state = .active
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
        } else if stored != login {
            // Different account — reset onboarding so the new user gets the full flow.
            persistPhase(.notStarted)
            defaults.set(false, forKey: "hkAuthorizationGranted")
            defaults.set(login, forKey: lastLoginKey)
        }
        // Same login — no action.
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
