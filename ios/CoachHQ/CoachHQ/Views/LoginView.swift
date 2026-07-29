import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @AppStorage(UserFacingError.devModeKey) private var devModeEnabled = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var devErrorDetail: String?

    var body: some View {
        VStack(spacing: 0) {
            loginWordmark
                .padding(.horizontal, 24)
                .padding(.top, 12)

            VStack(spacing: 28) {
                heroCard
                authSection
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
    }

    // MARK: - Wordmark

    private var loginWordmark: some View {
        HStack {
            Text("HQ")
                .font(WarmInstrument.monoLabel(12))
                .tracking(1.4)
                .foregroundColor(WarmInstrument.ink)
            Spacer(minLength: 0)
        }
    }

    // MARK: - Hero card

    private var heroCard: some View {
        WarmCard(padding: 24) {
            VStack(alignment: .leading, spacing: 18) {
                MonoLabel("Coach HQ", size: 10, tracking: 1.2)
                    .staggerReveal(delay: 0.12)

                Text("Your coaching dashboard")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .staggerReveal(delay: 0.18)

                Text("Train with intention. Sync from Health. Coach reads the data.")
                    .font(WarmInstrument.coachVoice(15))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
                    .staggerReveal(delay: 0.24)

                Rectangle()
                    .fill(WarmInstrument.headerRule)
                    .frame(height: 1)
                    .padding(.vertical, 2)
                    .staggerReveal(delay: 0.30)

                HStack(spacing: 8) {
                    LoginFeatureChip(icon: "heart.fill", label: "HealthKit sync")
                        .staggerReveal(delay: 0.36)
                    LoginFeatureChip(icon: "chevron.left.forwardslash.chevron.right", label: "GitHub repo")
                        .staggerReveal(delay: 0.42)
                    LoginFeatureChip(icon: "square.grid.2x2.fill", label: "Warm widgets")
                        .staggerReveal(delay: 0.48)
                }
            }
        }
        .staggerReveal(delay: 0.06, offset: 8)
    }

    // MARK: - Auth

    private var authSection: some View {
        VStack(spacing: 12) {
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
                        Image(systemName: "chevron.left.forwardslash.chevron.right")
                            .font(.system(size: 15, weight: .semibold))
                            .transition(.scale.combined(with: .opacity))
                    }
                    Text(isLoading ? "Signing in…" : "Sign in with GitHub")
                        .contentTransition(.opacity)
                }
                .animation(PremiumMotion.press, value: isLoading)
            }
            .buttonStyle(WarmLoginButtonStyle())
            .disabled(isLoading)
            .staggerReveal(delay: 0.54)

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
}

// MARK: - Feature chip

private struct LoginFeatureChip: View {
    let icon: String
    let label: String

    var body: some View {
        VStack(spacing: 7) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(WarmInstrument.inkMuted)

            Text(label)
                .font(WarmInstrument.monoLabel(7.5, weight: .semibold))
                .tracking(0.4)
                .foregroundColor(WarmInstrument.inkFaint)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 11)
        .padding(.horizontal, 4)
        .background(WarmInstrument.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
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
