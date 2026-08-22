import SwiftUI

/// Native equivalent of Setup.tsx's wizard. Shown when pendingSetupLogin is set - signed in
/// but no installation yet. Both steps use the shared in-app WKWebView cookie jar from sign-in.
struct SetupView: View {
    let login: String
    @EnvironmentObject var authManager: GitHubAuthManager
    @AppStorage(UserFacingError.devModeKey) private var devModeEnabled = false

    @State private var repoStepComplete = false
    @State private var isInstalling = false
    @State private var isSigningInAgain = false
    @State private var isCheckingRepo = true
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
            await refreshRepoStatus()
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

            if isCheckingRepo {
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
            if let error = errorMessage ?? authManager.lastNetworkError {
                Text(UserFacingError.friendlyAPIError(error))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(WarmInstrument.alarmFg)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 4)
                if devModeEnabled {
                    Text(error)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(WarmInstrument.inkFaint)
                        .multilineTextAlignment(.center)
                }
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

            if repoStepComplete {
                Button {
                    Haptics.tap()
                    signInAgain()
                } label: {
                    HStack(spacing: 6) {
                        if isSigningInAgain {
                            ProgressView().scaleEffect(0.7).tint(WarmInstrument.inkMuted)
                        }
                        Text(isSigningInAgain ? "Signing in…" : "Already linked? Sign in again")
                            .contentTransition(.opacity)
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .animation(PremiumMotion.press, value: isSigningInAgain)
                }
                .disabled(isInstalling || isSigningInAgain)
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
            return isInstalling
        }
        return generateURL == nil || isCheckingRepo
    }

    // MARK: - Actions

    private func refreshRepoStatus() async {
        isCheckingRepo = true
        defer { isCheckingRepo = false }

        // Never downgrade — URL detection may mark complete before the REST API catches up.
        if await authManager.coachRepoExists(for: login) {
            repoStepComplete = true
            return
        }

        // One retry after browse dismiss — GitHub can lag a second after repo create.
        if !repoStepComplete {
            try? await Task.sleep(for: .seconds(1))
            if await authManager.coachRepoExists(for: login) {
                repoStepComplete = true
            }
        }
    }

    @MainActor
    private func markRepoComplete() {
        guard !repoStepComplete else { return }
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
                    await refreshRepoStatus()
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
                Haptics.success()
            } catch {
                errorMessage = UserFacingError.message(for: error, devMode: devModeEnabled)
                Haptics.error()
            }
            isInstalling = false
        }
    }

    // Fallback for returning users who already have the GitHub App installed but whose
    // server session expired — re-runs the full sign-in so the server can re-discover
    // the existing installation and issue a fresh token without re-installing the App.
    private func signInAgain() {
        isSigningInAgain = true
        errorMessage = nil

        Task {
            do {
                try await authManager.signIn()
                Haptics.success()
            } catch {
                errorMessage = UserFacingError.message(for: error, devMode: devModeEnabled)
                Haptics.error()
            }
            isSigningInAgain = false
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
