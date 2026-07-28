import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 20) {
                ZStack {
                    Circle()
                        .fill(WarmInstrument.surfaceMuted)
                        .frame(width: 88, height: 88)
                    Image(systemName: "figure.badminton")
                        .font(.system(size: 40, weight: .semibold))
                        .foregroundColor(Theme.badmintonColor)
                }

                VStack(spacing: 8) {
                    Text("Coach HQ")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundColor(Theme.ink)

                    Text("Your personal coaching dashboard")
                        .font(WarmInstrument.coachVoice(15))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .multilineTextAlignment(.center)
                }
            }

            Spacer()

            VStack(spacing: 14) {
                Button {
                    Haptics.tap()
                    signIn()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Sign in with GitHub")
                    }
                }
                .buttonStyle(WarmLoginButtonStyle())
                .disabled(isLoading)
                .opacity(isLoading ? 0.55 : 1)

                if isLoading {
                    ProgressView()
                        .tint(WarmInstrument.inkMuted)
                }

                if let error = errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(WarmInstrument.accent)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 8)
                }
            }
            .padding(.horizontal, 32)

            Spacer()
                .frame(height: 56)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
    }

    private func signIn() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await authManager.signIn()
                Haptics.success()
            } catch {
                errorMessage = "Sign in failed: \(error.localizedDescription)"
                Haptics.error()
            }
            isLoading = false
        }
    }
}

/// Ink-filled primary button for login — terracotta is reserved for load CTAs elsewhere.
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
