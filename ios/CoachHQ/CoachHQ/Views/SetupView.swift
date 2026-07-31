import SwiftUI

/// Native equivalent of Setup.tsx's wizard. Shown when pendingSetupLogin is set - signed in
/// but no installation yet. Both steps use the shared in-app WKWebView cookie jar from sign-in.
struct SetupView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @AppStorage(UserFacingError.devModeKey) private var devModeEnabled = false

    @State private var repoStepComplete = false
    @State private var isInstalling = false
    @State private var isCheckingRepo = true
    @State private var errorMessage: String?

    private var login: String? { authManager.pendingSetupLogin }

    private var generateURL: URL? {
        guard let login else { return nil }
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

    private var currentStep: Int { repoStepComplete ? 2 : 1 }
    private var progressFraction: Double { repoStepComplete ? 1.0 : 0.5 }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 28) {
                OnboardingLogo()
                    .onboardingReveal(index: 0)

                VStack(spacing: 16) {
                    progressSection
                        .onboardingReveal(index: 1)

                    Text("Setting up your coach")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(WarmInstrument.ink)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .onboardingReveal(index: 2)

                    if !repoStepComplete {
                        Text("We'll create a private space for your workouts and goals — takes about a minute.")
                            .font(WarmInstrument.coachVoice(15))
                            .foregroundColor(WarmInstrument.inkMuted)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .lineSpacing(3)
                            .onboardingReveal(index: 3)
                            .transition(.opacity)
                    }

                    if repoStepComplete {
                        repoReadyHint
                            .onboardingReveal(index: 4)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                .padding(.horizontal, 32)
                .animation(PremiumMotion.state, value: repoStepComplete)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

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

    private var progressSection: some View {
        VStack(spacing: 8) {
            HStack {
                MonoLabel("Step \(currentStep) of 2", size: 9, tracking: 1.0)
                Spacer(minLength: 0)
                if isCheckingRepo {
                    ProgressView()
                        .scaleEffect(0.65)
                        .tint(WarmInstrument.inkMuted)
                }
            }

            HairlineProgress(
                fraction: progressFraction,
                tint: WarmInstrument.ink,
                height: 4
            )
            .animation(PremiumMotion.state, value: progressFraction)
        }
    }

    private var repoReadyHint: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(WarmInstrument.inkMuted)
            Text("Your training log is ready")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(WarmInstrument.inkFaint)
        }
    }

    private var installHintCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("ON THE NEXT SCREEN")
                .font(WarmInstrument.monoLabel(9))
                .foregroundColor(WarmInstrument.inkFaint)
                .tracking(1.0)

            VStack(alignment: .leading, spacing: 8) {
                hintRow(n: 1, label: md("Choose **Only select repositories**"))
                hintRow(n: 2, label: md("Pick **coach-\(login ?? "yours")**"))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WarmInstrument.paper)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
    }

    private func hintRow(n: Int, label: AttributedString) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(n)")
                .font(WarmInstrument.monoLabel(9))
                .foregroundColor(WarmInstrument.paper)
                .frame(width: 16, height: 16)
                .background(WarmInstrument.inkFaint.opacity(0.5))
                .clipShape(Circle())
            Text(label)
                .font(.system(size: 13))
                .foregroundColor(WarmInstrument.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func md(_ string: String) -> AttributedString {
        (try? AttributedString(markdown: string)) ?? AttributedString(string)
    }

    // MARK: - Action section

    private var actionSection: some View {
        VStack(spacing: 12) {
            if repoStepComplete {
                installHintCard
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }

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
        guard let login else {
            isCheckingRepo = false
            return
        }
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
        guard let generateURL, let login else { return }
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
}

// MARK: - HealthKit pre-permission screen

/// Shown once before the system HealthKit dialog — explains in plain language what Coach
/// reads and why, so the user isn't met cold by an OS permission sheet.
struct HealthKitPrePromptView: View {
    let onConnect: () -> Void
    let onSkip: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                // Large pull-quote serif headline — the visual anchor
                Text("I read every\nworkout you do.")
                    .font(.system(size: 36, weight: .semibold, design: .serif))
                    .italic()
                    .foregroundColor(WarmInstrument.ink)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .onboardingReveal(index: 0)
                    .padding(.bottom, 28)

                Text("Duration, heart rate, sport type — that's how I learn your patterns and give you real feedback instead of generic advice.")
                    .font(WarmInstrument.coachVoice(16))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(4)
                    .onboardingReveal(index: 1)
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack(spacing: 12) {
                Button {
                    Haptics.tap()
                    onConnect()
                } label: {
                    Text("Connect Health")
                }
                .buttonStyle(WarmSetupButtonStyle(primary: true))
                .onboardingReveal(index: 2)

                Button {
                    Haptics.tap()
                    onSkip()
                } label: {
                    Text("Not right now")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .frame(height: 44)
                }
                .buttonStyle(.plain)
                .onboardingReveal(index: 3)
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
