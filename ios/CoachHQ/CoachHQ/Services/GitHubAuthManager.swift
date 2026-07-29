import Foundation
import Combine
import AuthenticationServices
import Security

/// Manages sign-in via the shared coach-phelps-hq auth backend (ui/api/auth/) and token
/// storage. Used to be a standalone classic-OAuth-App flow with a client secret embedded in
/// the binary - moved to the same GitHub App + PKCE flow the web dashboard uses, entirely
/// server-side, so there's nothing secret shipped in this app at all. See
/// ui/api/auth/callback.ts's `platform === "ios"` branch and ADR-adjacent notes there for the
/// server side of this contract.
@MainActor
class GitHubAuthManager: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var isAuthenticated = false
    @Published var user: GitHubUser?
    @Published var selectedRepo: String?
    /// True once a stored-token bootstrap or fresh sign-in has finished loading
    /// `user` and attempting repo discovery. Home should wait for this before
    /// calling the GitHub API — otherwise `selectedRepo` is still nil and reads
    /// look like a sign-in failure.
    @Published private(set) var isSessionReady = false
    /// Non-nil when sign-in succeeded but the account has no coach-phelps installation yet -
    /// CoachHQApp routes to SetupView while this is set (the native equivalent of
    /// pages/Setup.tsx). Cleared once continueToInstall() resolves a repo.
    @Published var pendingSetupLogin: String?

    private let keychainKey = "com.siblingshipyard.coachhq.github.token"
    private let callbackScheme = "coachhq"

    override init() {
        super.init()
        if loadToken() != nil {
            isAuthenticated = true
            Task { await bootstrapSession() }
        } else {
            isSessionReady = true
        }
    }

    // MARK: - ASWebAuthenticationPresentationContextProviding

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first else {
            preconditionFailure("No UIWindowScene available — OAuth should never be triggered without a connected scene")
        }
        return scene.windows.first(where: { $0.isKeyWindow })
            ?? scene.windows.first
            ?? UIWindow(windowScene: scene)
    }

    // MARK: - OAuth Flow

    /// Starts sign-in - identical entry point for new and returning users, matching the web
    /// "Continue with GitHub" button. All PKCE/state/token-exchange logic lives server-side in
    /// ui/api/auth/start.ts + callback.ts; this just opens that URL in a web session and reads
    /// what comes back on the coachhq:// redirect.
    func signIn() async throws {
        try await runAuthSession(path: "/api/auth/start")
    }

    /// SetupView's step 2 - re-enters the flow at the install step once the user has created
    /// their repo on GitHub's template page (step 1, opened externally in Safari). Mirrors
    /// pages/Setup.tsx's "Continue to install" link, via ui/api/auth/install-redirect.ts.
    func continueToInstall() async throws {
        try await runAuthSession(path: "/api/auth/install-redirect")
    }

    private func runAuthSession(path: String) async throws {
        guard var components = URLComponents(string: Secrets.dashboardBaseURL + path) else {
            throw AuthError.invalidBaseURL
        }
        components.queryItems = [URLQueryItem(name: "platform", value: "ios")]
        guard let authURL = components.url else {
            throw AuthError.invalidBaseURL
        }

        let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: self.callbackScheme
            ) { url, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let url = url {
                    continuation.resume(returning: url)
                } else {
                    continuation.resume(throwing: AuthError.missingCallback)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }

        try await handleCallback(callbackURL)
    }

    /// Parses the coachhq://callback redirect from either entry point above. Three shapes,
    /// matching callback.ts's platform === "ios" branches:
    ///   ?error=<type>              - something failed server-side, see AuthError.serverError
    ///   ?needs_setup=1&login=<x>   - signed in, no installation yet -> route to SetupView
    ///   ?token=<x>&login=<x>[&repo=<x>] - signed in and installed; repo included when
    ///                                     callback.ts found exactly one owned+confirmed repo
    ///                                     (the common case - installs are single-repo)
    private func handleCallback(_ url: URL) async throws {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        func value(_ name: String) -> String? { items.first(where: { $0.name == name })?.value }

        if let errorType = value("error") {
            throw AuthError.serverError(errorType)
        }

        if value("needs_setup") == "1" {
            pendingSetupLogin = value("login")
            isSessionReady = true
            return
        }

        guard let token = value("token") else {
            throw AuthError.missingCode
        }
        saveToken(token)
        pendingSetupLogin = nil
        isAuthenticated = true

        if let repo = value("repo") {
            selectedRepo = repo
            isSessionReady = false
            await fetchUser()
            isSessionReady = true
        } else {
            // Rare: not exactly one owned+confirmed repo on this installation (legacy
            // multi-repo installs, or none confirmed yet). Falls back to the same
            // ownership/marker-file resolution list-my-repos.ts runs for the web onboarding
            // screen - see resolveRepoIfNeeded(). If that still can't resolve one repo,
            // selectedRepo stays nil; there's no native picker UI for the 2+ case yet.
            await bootstrapSession()
        }
    }

    /// Loads profile + resolves repo (if not already known) after sign-in or cold launch with
    /// a stored token.
    func bootstrapSession() async {
        isSessionReady = false
        await fetchUser()
        await resolveRepoIfNeeded()
        // Couldn't resolve a repo at all (rare - not exactly one owned+confirmed candidate,
        // and list-my-repos.ts's fallback also came up empty). Route back into the Setup
        // wizard instead of leaving CoachHQApp stuck on a broken MainTabView with no repo -
        // see CoachHQApp.swift's routing, which checks this alongside isAuthenticated.
        if selectedRepo == nil {
            pendingSetupLogin = user?.login
        }
        isSessionReady = true
    }

    /// Fallback repo resolution for the rare case handleCallback() didn't already get one -
    /// same ownership/marker-file logic web's Onboarding.tsx drives, via list-my-repos.ts's
    /// bearer-token auth path.
    private func resolveRepoIfNeeded() async {
        guard selectedRepo == nil, let token = loadToken() else { return }
        guard let url = URL(string: Secrets.dashboardBaseURL + "/api/auth/list-my-repos") else { return }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            if let result = try? JSONDecoder().decode(RepoResolution.self, from: data) {
                selectedRepo = result.repoFullName
            }
        } catch {
            print("Failed to resolve repo: \(error)")
        }
    }

    // MARK: - User

    /// Fetches the authenticated user's profile
    func fetchUser() async {
        guard let token = loadToken() else { return }
        var request = URLRequest(url: URL(string: "https://api.github.com/user")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            user = try JSONDecoder().decode(GitHubUser.self, from: data)
        } catch {
            print("Failed to fetch user: \(error)")
        }
    }

    // MARK: - Token Management (Keychain)

    func loadToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keychainKey,
            kSecReturnData as String: true
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func saveToken(_ token: String) {
        let data = token.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keychainKey,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary) // Remove existing
        SecItemAdd(query as CFDictionary, nil)
    }

    func signOut() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keychainKey
        ]
        SecItemDelete(query as CFDictionary)
        isAuthenticated = false
        isSessionReady = true
        user = nil
        selectedRepo = nil
        pendingSetupLogin = nil
    }
}

// MARK: - Supporting Types

struct GitHubUser: Codable {
    let login: String
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case login
        case avatarUrl = "avatar_url"
    }
}

private struct RepoResolution: Codable {
    let repoFullName: String?

    enum CodingKeys: String, CodingKey {
        case repoFullName = "repo_full_name"
    }
}

enum AuthError: Error, LocalizedError {
    case missingCode
    case missingCallback
    case invalidBaseURL
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .missingCode: return "No token received from Coach HQ."
        case .missingCallback: return "Sign-in didn't complete - no response received."
        case .invalidBaseURL: return "Coach HQ's URL is misconfigured."
        case .serverError(let type): return "Sign-in failed (\(type)). Try again."
        }
    }
}
