import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @AppStorage(UserFacingError.devModeKey) private var devModeEnabled = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var devErrorDetail: String?
    @State private var isRetryingMultipleRepos = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 28) {
                OnboardingLogo()
                    .onboardingReveal(index: 0)

                VStack(spacing: 16) {
                    Text("AI PERSONAL TRAINER")
                        .font(WarmInstrument.monoLabel(10))
                        .tracking(1.6)
                        .foregroundColor(WarmInstrument.inkFaint)
                        .onboardingReveal(index: 1)

                    Text("Train the process.\nThe outcome follows.")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(WarmInstrument.ink)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .onboardingReveal(index: 2)

                    Text(
                        "A coach that reads your training, your match scores, and your heart-rate trends — then builds the week around your goals."
                    )
                    .font(WarmInstrument.coachVoice(15))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
                    .onboardingReveal(index: 3)
                }
                .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            authSection
                .padding(.horizontal, 24)
                .safeAreaPadding(.bottom, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
    }

    // MARK: - Auth

    private var authSection: some View {
        VStack(spacing: 12) {
            if authManager.multipleReposDetected {
                // 2+ repos granted (ADR 0019) - block, don't let the athlete sign in again
                // until they've removed access to the extras in GitHub's own settings.
                Text("Your GitHub App install grants access to more than one repo you own, and Coach Phelps only supports one repo per account. Open GitHub's installation settings, deselect all but one repo, then come back and sign in again.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(WarmInstrument.ink)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 4)

                Link("Open GitHub settings", destination: URL(string: "https://github.com/settings/installations")!)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(WarmInstrument.paper)
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(Theme.ink)
                    .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))

                // Without this, the athlete has no way back in after fixing their install
                // short of force-quitting the app so bootstrapSession() reruns on cold start.
                Button {
                    Haptics.tap()
                    retryAfterMultipleRepos()
                } label: {
                    HStack(spacing: 8) {
                        if isRetryingMultipleRepos {
                            ProgressView().scaleEffect(0.85)
                        }
                        Text(isRetryingMultipleRepos ? "Checking…" : "I've removed access - try again")
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(WarmInstrument.inkMuted)
                }
                .disabled(isRetryingMultipleRepos)
            } else {
                if let error = errorMessage ?? authManager.lastNetworkError {
                    Text(error)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(WarmInstrument.alarmFg)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 4)
                    if devModeEnabled, let devErrorDetail {
                        Text(devErrorDetail)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(WarmInstrument.inkFaint)
                            .multilineTextAlignment(.center)
                    }
                }

                Button {
                    Haptics.tap()
                    signIn()
                } label: {
                    HStack(spacing: 10) {
                        if isLoading {
                            ProgressView()
                                .tint(WarmInstrument.paper)
                                .scaleEffect(0.85)
                                .transition(.scale.combined(with: .opacity))
                        } else {
                            Image("GitHubMark")
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 18, height: 18)
                                .transition(.scale.combined(with: .opacity))
                        }
                        Text(isLoading ? "Signing in…" : "Sign in with GitHub")
                            .contentTransition(.opacity)
                    }
                    .animation(PremiumMotion.press, value: isLoading)
                }
                .buttonStyle(WarmLoginButtonStyle())
                .disabled(isLoading)
                .onboardingReveal(index: 4)
            }
        }
    }

    private func signIn() {
        isLoading = true
        errorMessage = nil
        devErrorDetail = nil

        Task {
            do {
                try await authManager.signIn()
                Haptics.success()
            } catch {
                errorMessage = UserFacingError.message(for: error, devMode: false)
                devErrorDetail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                Haptics.error()
            }
            isLoading = false
        }
    }

    private func retryAfterMultipleRepos() {
        isRetryingMultipleRepos = true
        Task {
            await authManager.retryAfterMultipleRepos()
            isRetryingMultipleRepos = false
        }
    }
}

// MARK: - Ink primary button (auth — terracotta reserved for load CTAs)

private struct WarmLoginButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity)
            .frame(height: 54)
            .background(Theme.ink.opacity(configuration.isPressed ? 0.85 : 1))
            .foregroundColor(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: WarmInstrument.cardRadius, style: .continuous))
            .shadow(color: WarmInstrument.cardShadow, radius: 10, y: 5)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.15, bounce: 0), value: configuration.isPressed)
    }
}
