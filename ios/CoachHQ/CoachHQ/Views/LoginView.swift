import SwiftUI

struct LoginView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Logo / Branding
            VStack(spacing: 14) {
                Image(systemName: "figure.badminton")
                    .font(.system(size: 56))
                    .foregroundColor(Theme.accentGreen)

                Text("Coach HQ")
                    .font(.system(size: 30, weight: .bold, design: .rounded))

                Text("Your AI coaching system")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Sign In Button
            VStack(spacing: 16) {
                Button(action: signIn) {
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Sign in with GitHub")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isLoading)
                .opacity(isLoading ? 0.5 : 1)

                if isLoading {
                    ProgressView()
                        .tint(Theme.accentGreen)
                }

                if let error = errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 32)

            Spacer()
                .frame(height: 48)
        }
        .background(Color(uiColor: .systemBackground))
    }

    private func signIn() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await authManager.signIn()
            } catch {
                errorMessage = "Sign in failed: \(error.localizedDescription)"
            }
            isLoading = false
        }
    }
}
