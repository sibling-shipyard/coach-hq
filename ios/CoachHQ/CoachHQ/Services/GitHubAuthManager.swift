import Foundation
import Combine
import AuthenticationServices
import Security

/// Manages sign-in via the shared coach-phelps-hq auth backend (ui/api/auth/) and token
/// storage. Same GitHub App + PKCE flow the web dashboard uses, entirely server-side, so
/// there's no client secret shipped in this app. See callback.ts's `platform === "ios"` branch.
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
    /// Surfaced by LoginView/SetupView so a network blip during sign-in doesn't leave
    /// `user`/`selectedRepo` silently unset with no signal to the person looking at the screen.
    @Published var lastNetworkError: String?

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

    /// Identical entry point for new and returning users, matching the web "Log in with
    /// GitHub" button. PKCE/state/token-exchange all live server-side in start.ts + callback.ts.
    func signIn() async throws {
        try await runAuthSession(path: "/api/auth/start")
    }

    /// SetupView's step 2 - re-enters the flow at install once the user has created their repo
    /// on GitHub's template page. Mirrors Setup.tsx's "Continue to install" link.
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

    /// Parses the coachhq://callback redirect. Three shapes, matching callback.ts's
    /// platform === "ios" branches: ?error=<type>, ?needs_setup=1&login=<x>, or
    /// ?token=<x>&login=<x>[&repo=<x>] (repo included when there's exactly one candidate).
    private func handleCallback(_ url: URL) async throws {
        lastNetworkError = nil
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
        if let refreshToken = value("refresh_token"), let expiresAtRaw = value("expires_at"),
           let expiresAtMs = Double(expiresAtRaw) {
            saveRefreshToken(refreshToken, expiresAt: Date(timeIntervalSince1970: expiresAtMs / 1000))
        }
        pendingSetupLogin = nil
        isAuthenticated = true

        if let repo = value("repo") {
            selectedRepo = repo
            isSessionReady = false
            await fetchUser()
            isSessionReady = true
        } else {
            // Rare: not exactly one candidate repo. Falls back to resolveRepoIfNeeded(); if
            // that still can't resolve one, selectedRepo stays nil - no native picker for 2+.
            await bootstrapSession()
        }
    }

    /// Loads profile + resolves repo (if not already known) after sign-in or cold launch with
    /// a stored token.
    func bootstrapSession() async {
        isSessionReady = false
        await fetchUser()
        await resolveRepoIfNeeded()
        // Couldn't resolve a repo at all - route back into Setup instead of leaving
        // CoachHQApp stuck on a broken MainTabView with no repo.
        if selectedRepo == nil {
            pendingSetupLogin = user?.login
        }
        isSessionReady = true
    }

    /// Fallback repo resolution for the rare case handleCallback() didn't already get one,
    /// via list-my-repos.ts's bearer-token auth path.
    private func resolveRepoIfNeeded() async {
        guard selectedRepo == nil, let token = await validToken() else { return }
        guard let url = URL(string: Secrets.dashboardBaseURL + "/api/auth/list-my-repos") else { return }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            if let result = try? JSONDecoder().decode(RepoResolution.self, from: data) {
                selectedRepo = result.repoFullName
            }
        } catch {
            lastNetworkError = "Couldn't look up your repo just now - check your connection and try again."
            print("Failed to resolve repo: \(error)")
        }
    }

    // MARK: - User

    /// Fetches the authenticated user's profile
    func fetchUser() async {
        // validToken(), not loadToken() - runs before GitHubAPIClient's proactive refresh
        // gets a chance to, so a token expired since last session would 401 needlessly at startup.
        guard let token = await validToken() else { return }
        var request = URLRequest(url: URL(string: "https://api.github.com/user")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            user = try JSONDecoder().decode(GitHubUser.self, from: data)
        } catch {
            lastNetworkError = "Couldn't load your GitHub profile just now - check your connection and try again."
            print("Failed to fetch user: \(error)")
        }
    }

    // MARK: - Token Management (Keychain)

    private let refreshTokenKeychainKey = "com.siblingshipyard.coachhq.github.refresh_token"
    private let expiresAtKeychainKey = "com.siblingshipyard.coachhq.github.expires_at"

    private func loadKeychainString(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func saveKeychainString(_ value: String, for key: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary) // Remove existing
        SecItemAdd(query as CFDictionary, nil)
    }

    private func deleteKeychainString(for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
    }

    func loadToken() -> String? {
        loadKeychainString(keychainKey)
    }

    private func saveToken(_ token: String) {
        saveKeychainString(token, for: keychainKey)
    }

    /// Mirrors session.ts's refresh_token/gh_token_expires_at fields. A classic client-side
    /// refresh would need client_secret embedded in the app, so this hits /api/auth/refresh
    /// instead, which does the confidential exchange server-side.
    private func saveRefreshToken(_ refreshToken: String, expiresAt: Date) {
        saveKeychainString(refreshToken, for: refreshTokenKeychainKey)
        saveKeychainString(String(expiresAt.timeIntervalSince1970), for: expiresAtKeychainKey)
    }

    private func loadRefreshToken() -> String? {
        loadKeychainString(refreshTokenKeychainKey)
    }

    private func loadExpiresAt() -> Date? {
        guard let raw = loadKeychainString(expiresAtKeychainKey), let interval = Double(raw) else { return nil }
        return Date(timeIntervalSince1970: interval)
    }

    /// Returns a token usable for the next request, refreshing first if near expiry. Falls
    /// back to whatever's stored on a refresh failure - a resulting 401 is still handled by
    /// GitHubAPIClient's existing "sign in again" path, just without silent recovery.
    func validToken() async -> String? {
        guard let token = loadToken() else { return nil }
        guard let expiresAt = loadExpiresAt(), expiresAt > Date().addingTimeInterval(300) else {
            return await refreshAccessToken() ?? token
        }
        return token
    }

    // GitHub rotates refresh tokens on each use - concurrent callers racing to refresh with
    // the same stored refresh_token would have the loser's exchange rejected. @MainActor
    // already serializes access, so caching the in-flight task here makes callers share one
    // exchange instead of racing.
    private var refreshTask: Task<String?, Never>?

    private func refreshAccessToken() async -> String? {
        if let existing = refreshTask {
            return await existing.value
        }
        let task = Task<String?, Never> { [weak self] in
            await self?.performRefreshAccessToken()
        }
        refreshTask = task
        let result = await task.value
        refreshTask = nil
        return result
    }

    private func performRefreshAccessToken() async -> String? {
        guard let refreshToken = loadRefreshToken() else { return nil }
        guard let url = URL(string: Secrets.dashboardBaseURL + "/api/auth/refresh") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["refresh_token": refreshToken])

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            let result = try JSONDecoder().decode(RefreshResponse.self, from: data)
            saveToken(result.accessToken)
            saveRefreshToken(result.refreshToken, expiresAt: Date().addingTimeInterval(result.expiresIn))
            return result.accessToken
        } catch {
            print("Token refresh failed: \(error)")
            return nil
        }
    }

    func signOut() {
        deleteKeychainString(for: keychainKey)
        deleteKeychainString(for: refreshTokenKeychainKey)
        deleteKeychainString(for: expiresAtKeychainKey)
        isAuthenticated = false
        isSessionReady = true
        user = nil
        selectedRepo = nil
        pendingSetupLogin = nil
        lastNetworkError = nil
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

private struct RefreshResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: TimeInterval

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
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
