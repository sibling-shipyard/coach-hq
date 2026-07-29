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
    @State private var showStep2Hint = false

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
        .task(id: login) {
            await refreshRepoStatus()
        }
    }

    // MARK: - Wordmark

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

    // MARK: - Card

    private var card: some View {
        WarmCard(padding: 24) {
            VStack(alignment: .leading, spacing: 18) {
                MonoLabel("Setting up your coach", size: 10, tracking: 1.2)

                Text("Two quick steps on GitHub")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(Theme.ink)

                Text("You're signed in\(login.map { " as \($0)" } ?? ""). After this, you'll meet Coach in chat — your dashboard fills in from that first conversation.")
                    .font(WarmInstrument.coachVoice(14))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)

                Rectangle()
                    .fill(WarmInstrument.headerRule)
                    .frame(height: 1)
                    .padding(.vertical, 2)

                VStack(spacing: 10) {
                    stepRow(
                        number: 1,
                        title: "Create your coach repo",
                        subtitle: repoStepComplete
                            ? "coach-\(login ?? "you") exists on GitHub"
                            : "Pre-filled from the coach-skeleton template",
                        complete: repoStepComplete,
                        isLoading: isCheckingRepo
                    )

                    stepRow(
                        number: 2,
                        title: "Authorize Coach Phelps",
                        subtitle: "Grant access to that one repo only — not another sign-in",
                        complete: false,
                        isLoading: isInstalling
                    )
                }

                VStack(spacing: 12) {
                    if !repoStepComplete {
                        Button {
                            Haptics.tap()
                            openCreateRepo()
                        } label: {
                            Text("Create repo on GitHub")
                        }
                        .buttonStyle(WarmSetupButtonStyle(primary: true))
                        .disabled(generateURL == nil || isCheckingRepo)
                    } else {
                        Button {
                            Haptics.tap()
                            continueToInstall()
                        } label: {
                            HStack(spacing: 10) {
                                if isInstalling {
                                    ProgressView()
                                        .tint(WarmInstrument.paper)
                                        .scaleEffect(0.85)
                                }
                                Text(isInstalling ? "Opening GitHub…" : "Authorize Coach Phelps →")
                            }
                        }
                        .buttonStyle(WarmSetupButtonStyle(primary: true))
                        .disabled(isInstalling)
                    }

                    if showStep2Hint && repoStepComplete {
                        Text("Repo ready — tap above to connect Coach Phelps.")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(WarmInstrument.ink)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
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
                }
            }
        }
    }

    @ViewBuilder
    private func stepRow(
        number: Int,
        title: String,
        subtitle: String,
        complete: Bool,
        isLoading: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(complete ? WarmInstrument.ink : WarmInstrument.surfaceMuted)
                    .frame(width: 28, height: 28)
                if isLoading {
                    ProgressView()
                        .scaleEffect(0.55)
                        .tint(WarmInstrument.ink)
                } else if complete {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(WarmInstrument.paper)
                } else {
                    Text("\(number)")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(WarmInstrument.ink)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(complete ? WarmInstrument.surfaceMuted.opacity(0.6) : WarmInstrument.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: - Actions

    private func refreshRepoStatus() async {
        guard let login else {
            isCheckingRepo = false
            return
        }
        isCheckingRepo = true
        repoStepComplete = await authManager.coachRepoExists(for: login)
        isCheckingRepo = false
    }

    private func markRepoComplete() {
        guard !repoStepComplete else { return }
        repoStepComplete = true
        showStep2Hint = true
        Haptics.success()
        WebAuthPresenter.shared.dismissBrowse()
    }

    private func openCreateRepo() {
        guard let generateURL, let login else { return }
        guard !repoStepComplete else { return }

        WebAuthPresenter.shared.presentBrowse(
            url: generateURL,
            onNavigation: { url in
                if authManager.isCoachRepoCreationURL(url, login: login) {
                    markRepoComplete()
                }
            },
            onDismiss: {
                Task { await refreshRepoStatus() }
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

// MARK: - Setup button style

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
