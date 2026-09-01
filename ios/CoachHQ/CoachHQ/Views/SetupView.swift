import SwiftUI

/// Native equivalent of Setup.tsx's wizard. Shown when pendingSetupLogin is set — signed in
/// but setup not complete. Checks two conditions directly against GitHub's API so returning
/// users aren't blocked by an expired server session:
///   Step 1 — does `coach-<login>` repo exist?
///   Step 2 — does the coach-phelps App have access to it?
/// When both pass, activateDirectly() sets auth state immediately — no OAuth round-trip.
struct SetupView: View {
    let login: String
    @EnvironmentObject var authManager: GitHubAuthManager
    @AppStorage(UserFacingError.devModeKey) private var devModeEnabled = false

    @State private var repoStepComplete = false
    @State private var installStepComplete = false
    @State private var isChecking = true
    @State private var isInstalling = false
    @State private var errorMessage: String?

    private var generateURL: URL? {
        var components = URLComponents(string: "https://github.com/new")!
        components.queryItems = [
            URLQueryItem(name: "template_owner", value: "sibling-shipyard"),
            URLQueryItem(name: "template_name", value: "coach-skeleton"),
            URLQueryItem(name: "owner", value: login),
            URLQueryItem(name: "name", value: "coach-\(login)"),
            URLQueryItem(name: "visibility", value: "private"),
        ]
        return components.url
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                if repoStepComplete {
                    step2Content
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing).combined(with: .opacity),
                            removal: .move(edge: .leading).combined(with: .opacity)
                        ))
                } else {
                    step1Content
                        .transition(.asymmetric(
                            insertion: .move(edge: .trailing).combined(with: .opacity),
                            removal: .move(edge: .leading).combined(with: .opacity)
                        ))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(PremiumMotion.state, value: repoStepComplete)

            actionSection
                .padding(.horizontal, 24)
                .safeAreaPadding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
        .overlay(alignment: .topTrailing) {
            Button {
                Haptics.tap()
                authManager.signOut()
            } label: {
                Text("Cancel")
                    .font(WarmInstrument.monoLabel(10.5))
                    .tracking(0.8)
                    .foregroundColor(WarmInstrument.inkMuted)
            }
            .padding(.horizontal, 24)
            .padding(.top, 12)
        }
        .task(id: login) {
            await refreshSetupStatus()
        }
    }

    // MARK: - Step content

    private var step1Content: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Wiring up your\nGitHub repo.")
                .font(WarmInstrument.coachVoice(30))
                .foregroundColor(WarmInstrument.ink)
                .fixedSize(horizontal: false, vertical: true)
                .onboardingReveal(index: 0)
                .padding(.bottom, 28)

            VStack(alignment: .leading, spacing: 14) {
                stepBullet("Create your training log once")
                stepBullet("All your workouts in one private place")
                stepBullet("Coach reads it, you never re-explain")
            }
            .onboardingReveal(index: 1)

            if isChecking {
                ProgressView()
                    .scaleEffect(0.65)
                    .tint(WarmInstrument.inkMuted)
                    .padding(.top, 24)
                    .onboardingReveal(index: 2)
            }
        }
        .padding(.horizontal, 32)
    }

    private var step2Content: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Connect Coach\nto your repo.")
                .font(WarmInstrument.coachVoice(30))
                .foregroundColor(WarmInstrument.ink)
                .fixedSize(horizontal: false, vertical: true)
                .onboardingReveal(index: 0)
                .padding(.bottom, 28)

            if isChecking {
                ProgressView()
                    .scaleEffect(0.65)
                    .tint(WarmInstrument.inkMuted)
                    .onboardingReveal(index: 1)
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    numberedStep(1,
                        prefix: "When GitHub asks which repositories to share, choose ",
                        bold: "Only select repositories",
                        suffix: ".")
                    numberedStep(2,
                        prefix: "Pick ",
                        bold: "coach-\(login)",
                        suffix: ". Don't grant access to everything.")
                }
                .onboardingReveal(index: 1)
            }
        }
        .padding(.horizontal, 32)
    }

    @ViewBuilder
    private func stepBullet(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("—")
                .font(WarmInstrument.monoLabel(13))
                .foregroundColor(WarmInstrument.inkFaint)
            Text(text)
                .font(.system(size: 14))
                .foregroundColor(WarmInstrument.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func numberedStep(_ n: Int, prefix: String, bold: String, suffix: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(WarmInstrument.monoLabel(13))
                .foregroundColor(WarmInstrument.inkFaint)
                .frame(width: 16, alignment: .center)
            Text("\(prefix)\(Text(bold).fontWeight(.semibold))\(suffix)")
                .font(.system(size: 14))
                .foregroundColor(WarmInstrument.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(3)
        }
    }

    // MARK: - Action section

    private var actionSection: some View {
        VStack(spacing: 12) {
            if let error = errorMessage {
                Text(error)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(WarmInstrument.alarmFg)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 4)
            }

            Button {
                Haptics.tap()
                if repoStepComplete {
                    continueToInstall()
                } else {
                    openCreateRepo()
                }
            } label: {
                HStack(spacing: 10) {
                    if isInstalling {
                        ProgressView()
                            .tint(WarmInstrument.paper)
                            .scaleEffect(0.85)
                            .transition(.scale.combined(with: .opacity))
                    }
                    Text(primaryButtonLabel)
                        .contentTransition(.opacity)
                }
                .animation(PremiumMotion.press, value: isInstalling)
            }
            .buttonStyle(WarmSetupButtonStyle(primary: true))
            .disabled(primaryButtonDisabled)
            .onboardingReveal(index: 5)

            // Escape hatch — re-checks GitHub API immediately without opening a browser.
            // Useful when the auto-check on load failed transiently and the conditions are
            // now met (e.g. user installed the App on a different device, or API was slow).
            if repoStepComplete && !isChecking && !isInstalling {
                Button {
                    Haptics.tap()
                    Task { await refreshSetupStatus() }
                } label: {
                    Text("Already linked? Check again")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
                .onboardingReveal(index: 6)
            }
        }
        .animation(PremiumMotion.onboardingReveal, value: repoStepComplete)
    }

    private var primaryButtonLabel: String {
        if repoStepComplete {
            return isInstalling ? "Opening GitHub…" : "Link Your Log"
        }
        return "Create Your Log"
    }

    private var primaryButtonDisabled: Bool {
        if repoStepComplete {
            return isInstalling || isChecking
        }
        return generateURL == nil || isChecking
    }

    // MARK: - Status checks

    /// Checks both prerequisites directly against GitHub's API. If both pass, activates
    /// the session directly — no OAuth round-trip needed, the token is already proven valid
    /// by the API calls themselves.
    private func refreshSetupStatus() async {
        isChecking = true
        errorMessage = nil
        defer { isChecking = false }

        // Step 1 — repo (skip the network call if already confirmed this session)
        if !repoStepComplete {
            let repoExists = await authManager.coachRepoExists(for: login)
            if !repoExists {
                // One retry — GitHub can lag a second after repo create.
                try? await Task.sleep(for: .seconds(1))
                repoStepComplete = await authManager.coachRepoExists(for: login)
            } else {
                repoStepComplete = true
            }
            guard repoStepComplete else { return }
        }

        // Step 2 — GitHub App installation (direct API, no server session dependency).
        // nil = check failed (network/token issue), false = confirmed not installed.
        switch await authManager.coachAppInstalled(for: login) {
        case true:
            installStepComplete = true
            await authManager.activateDirectly(for: login)
        case false:
            // App genuinely not installed — show the Link Your Log button, no error.
            break
        case nil:
            // GitHub API unreachable or token rejected. Surface a specific message so the
            // user doesn't assume they need to redo the install — they may just need to
            // retry once their connection or token is restored.
            errorMessage = devModeEnabled
                ? "GitHub App check failed — token may be expired or network unavailable."
                : "Couldn't verify your GitHub access. Check your connection and try again."
        }
    }

    // MARK: - Actions

    @MainActor
    private func markRepoComplete() {
        guard !repoStepComplete else { return }
        // Just watched GitHub finish creating coach-<login> from the template — any prior
        // "onboarding complete" Keychain flag for that name belongs to a repo that no longer
        // exists (deleted and recreated under this app's one fixed name). See clear()'s doc.
        CoachSetupState.clear(repoFullName: "\(login)/coach-\(login)")
        repoStepComplete = true
        Haptics.success()
        WebAuthPresenter.shared.dismissBrowse()
    }

    private func openCreateRepo() {
        guard let generateURL else { return }
        guard !repoStepComplete else { return }

        WebAuthPresenter.shared.presentBrowse(
            url: generateURL,
            onNavigation: { url in
                guard authManager.isCoachRepoCreationURL(url, login: login) else { return }
                Task { @MainActor in
                    markRepoComplete()
                }
            },
            onDismiss: {
                Task { @MainActor in
                    await refreshSetupStatus()
                }
            }
        )
    }

    private func continueToInstall() {
        isInstalling = true
        errorMessage = nil

        Task {
            do {
                try await authManager.continueToInstall()
                // If handleCallback() routed to .active, SetupView is already gone.
                // If needs_setup=1 or cancel, we fall through and re-check below.
            } catch {
                errorMessage = UserFacingError.message(for: error, devMode: devModeEnabled)
                Haptics.error()
            }
            isInstalling = false
            // Re-check GitHub API directly. activateDirectly() routes to .active without
            // opening any browser, so there is no loop risk here.
            await refreshSetupStatus()
        }
    }
}

// MARK: - HealthKit pre-permission screen

/// Shown once before the system HealthKit dialog — explains in plain language what Coach
/// reads and why, so the user isn't met cold by an OS permission sheet.
/// Health access is required; there is no skip option.
struct HealthKitPrePromptView: View {
    let onConnect: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Matches OnboardingRevealFlow header so dots sit at the same position
            HStack {
                Color.clear.frame(width: 36, height: 36)
                Spacer()
                OnboardingDots(step: 0, total: 5)
                    .onboardingReveal(index: 0)
                Spacer()
                Color.clear.frame(width: 36, height: 36)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 4)

            VStack(alignment: .leading, spacing: 0) {
                Text("I read every\nworkout you do.")
                    .font(WarmInstrument.coachVoice(30))
                    .foregroundColor(WarmInstrument.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .onboardingReveal(index: 1)
                    .padding(.bottom, 20)

                Text("Duration, heart rate, sport type. That's how I learn your patterns and give you real feedback instead of generic advice.")
                    .font(WarmInstrument.coachVoice(15))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(4)
                    .onboardingReveal(index: 2)
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

            VStack(spacing: 12) {
                Button {
                    Haptics.tap()
                    onConnect()
                } label: {
                    Text("Connect Health")
                }
                .buttonStyle(WarmSetupButtonStyle(primary: true))
                .onboardingReveal(index: 3)

                Text("Health access is required for Coach to work.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 8)
                    .onboardingReveal(index: 4)
            }
            .padding(.horizontal, 24)
            .safeAreaPadding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
    }
}

// MARK: - Setup button style

struct WarmSetupButtonStyle: ButtonStyle {
    let primary: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(primaryBackground(pressed: configuration.isPressed))
            .foregroundColor(primary ? WarmInstrument.paper : Theme.ink)
            .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous)
                    .strokeBorder(primary ? Color.clear : WarmInstrument.border, lineWidth: 1)
            )
            .shadow(color: primary ? WarmInstrument.cardShadow : .clear, radius: 10, y: 5)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.15, bounce: 0), value: configuration.isPressed)
    }

    private func primaryBackground(pressed: Bool) -> Color {
        if primary {
            return Theme.ink.opacity(pressed ? 0.85 : 1)
        }
        return WarmInstrument.surfaceMuted
    }
}
