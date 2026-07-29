import SwiftUI

/// Native equivalent of Setup.tsx's wizard. Shown when pendingSetupLogin is set - signed in
/// but no installation yet. Step 1 opens system Safari instead of a webview, since
/// ASWebAuthenticationSession can't host a "click a link, come back" flow.
struct SetupView: View {
    @EnvironmentObject var authManager: GitHubAuthManager
    @State private var isInstalling = false
    @State private var errorMessage: String?

    private var generateURL: URL? {
        guard let login = authManager.pendingSetupLogin else { return nil }
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
            wordmark
                .padding(.horizontal, 24)
                .padding(.top, 12)

            VStack(spacing: 28) {
                card
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WarmInstrument.desk.ignoresSafeArea())
    }

    private var wordmark: some View {
        HStack {
            Text("HQ")
                .font(WarmInstrument.monoLabel(12))
                .tracking(1.4)
                .foregroundColor(WarmInstrument.ink)
            Spacer(minLength: 0)
            Button {
                Haptics.tap()
                authManager.signOut()
            } label: {
                Text("Cancel")
                    .font(WarmInstrument.monoLabel(10.5))
                    .tracking(0.8)
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }

    private var card: some View {
        WarmCard(padding: 24) {
            VStack(alignment: .leading, spacing: 18) {
                MonoLabel("Setting up your coach", size: 10, tracking: 1.2)

                Text("Two quick steps on GitHub")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                Text("You're signed in\(authManager.pendingSetupLogin.map { " as \($0)" } ?? ""). Coach Phelps stores everything in your own private GitHub repo, so there are two things GitHub needs you to confirm directly - after that, you're done.")
                    .font(WarmInstrument.coachVoice(14))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)

                Rectangle()
                    .fill(WarmInstrument.headerRule)
                    .frame(height: 1)
                    .padding(.vertical, 2)

                VStack(spacing: 12) {
                    Button {
                        Haptics.tap()
                        openGenerateURL()
                    } label: {
                        Text("1. Create your repo on GitHub ↗")
                    }
                    .buttonStyle(WarmSetupButtonStyle(primary: true))
                    .disabled(generateURL == nil)

                    Button {
                        Haptics.tap()
                        continueToInstall()
                    } label: {
                        HStack(spacing: 10) {
                            if isInstalling {
                                ProgressView()
                                    .tint(WarmInstrument.ink)
                                    .scaleEffect(0.85)
                            }
                            Text(isInstalling ? "Opening install…" : "2. Continue to install (after step 1) →")
                        }
                    }
                    .buttonStyle(WarmSetupButtonStyle(primary: false))
                    .disabled(isInstalling)

                    if let error = errorMessage ?? authManager.lastNetworkError {
                        Text(error)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(WarmInstrument.accent)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 4)
                    }
                }

                Text("Step 1 opens GitHub in Safari, pre-filled - just tap their green \"Create repository\" button. Once that's done, come back here and tap step 2, which gives Coach Phelps access to that one repo only. If you tap step 2 first, GitHub just won't have your repo to pick yet - go back and finish step 1, then try again.")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(2)
            }
        }
    }

    private func openGenerateURL() {
        guard let generateURL else { return }
        UIApplication.shared.open(generateURL)
    }

    private func continueToInstall() {
        isInstalling = true
        errorMessage = nil

        Task {
            do {
                try await authManager.continueToInstall()
                Haptics.success()
            } catch {
                errorMessage = "Couldn't continue: \(error.localizedDescription)"
                Haptics.error()
            }
            isInstalling = false
        }
    }
}

// MARK: - Setup button style (mirrors LoginView's WarmLoginButtonStyle, with a secondary variant)

private struct WarmSetupButtonStyle: ButtonStyle {
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
