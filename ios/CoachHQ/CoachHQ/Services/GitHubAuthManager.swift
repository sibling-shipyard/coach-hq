import Foundation
import Combine
import Security

/// Manages sign-in via the shared coach-phelps-hq auth backend (ui/api/auth/) and token
/// storage. Same GitHub App + PKCE flow the web dashboard uses, entirely server-side, so
/// there's no client secret shipped in this app. See callback.ts's `platform === "ios"` branch.
///
/// OAuth runs in a shared WKWebView (`WebAuthBrowserStore`) so GitHub cookies — including
/// Google federated login — persist into setup's repo-create and install steps.
@MainActor
class GitHubAuthManager: ObservableObject {
    @Published var isAuthenticated = false
    @Published var user: GitHubUser?
    @Published var selectedRepo: String?
    /// Full `owner/repo` slug for API headers and GitHub REST URLs. `selectedRepo` may
    /// already be a full name from OAuth/list-my-repos, or repo-name-only from legacy paths.
    var repoFullName: String? {
        guard let repo = selectedRepo, !repo.isEmpty else { return nil }
        if repo.contains("/") { return repo }
        guard let login = user?.login else { return nil }
        return "\(login)/\(repo)"
    }
    /// True once a stored-token bootstrap or fresh sign-in has finished loading
    /// `user` and attempting repo discovery. Home should wait for this before
    /// calling the GitHub API — otherwise `selectedRepo` is still nil and reads
    /// look like a sign-in failure.
    @Published private(set) var isSessionReady = false
    /// Non-nil when sign-in succeeded but the account has no coach-phelps installation yet -
    /// CoachHQApp routes to SetupView while this is set (the native equivalent of
    /// pages/Setup.tsx). Cleared once continueToInstall() resolves a repo.
    @Published var pendingSetupLogin: String?
    /// True when list-my-repos came back 409 `multiple_repos_granted` (ADR 0019) - the account
    /// granted access to 2+ owned repos, which the app doesn't support. LoginView shows a
    /// blocking "remove access to the extra repos" message instead of routing to Setup.
    @Published var multipleReposDetected = false
    /// Surfaced by LoginView/SetupView so a network blip during sign-in doesn't leave
    /// `user`/`selectedRepo` silently unset with no signal to the person looking at the screen.
    @Published var lastNetworkError: String?
    /// True once any screen's API call comes back 401 - MainTabView shows one shared
    /// "sign in again" screen over the whole app instead of each tab reacting on its own
    /// (Home/Activity used to just toast it, Workouts didn't surface it at all).
    @Published var sessionExpired = false

    // internal (not private): GitHubAuthManagerTests exercises the combined-item read/write
    // and legacy-migration paths directly via @testable import, which can't see `private`.
    let keychainKey = "com.siblingshipyard.coachhq.github.token"
    private let callbackScheme = "coachhq"

    init() {
        if loadToken() != nil {
            isAuthenticated = true
            Task { await bootstrapSession() }
        } else {
            isSessionReady = true
        }
    }

    // MARK: - OAuth Flow

    /// Identical entry point for new and returning users, matching the web "Log in with
    /// GitHub" button. PKCE/state/token-exchange all live server-side in start.ts + callback.ts.
    func signIn() async throws {
        lastNetworkError = nil
        try await runAuthSession(path: "/api/auth/start")
    }

    /// SetupView's step 2 — authorize the GitHub App on the new repo (not a second sign-in).
    /// After this returns (success or cancel), SetupView calls refreshSetupStatus() which
    /// calls activateDirectly() if the App installation is now confirmed via GitHub API.
    func continueToInstall() async throws {
        guard var components = URLComponents(string: Secrets.dashboardBaseURL + "/api/auth/install-redirect") else {
            throw AuthError.invalidBaseURL
        }
        var query = [URLQueryItem(name: "platform", value: "ios")]
        if let userId = user?.id {
            query.append(URLQueryItem(name: "suggested_target_id", value: String(userId)))
        }
        components.queryItems = query
        guard let authURL = components.url else {
            throw AuthError.invalidBaseURL
        }

        do {
            let callbackURL = try await WebAuthPresenter.shared.start(
                url: authURL,
                callbackScheme: callbackScheme
            )
            try await handleCallback(callbackURL)
            // handleCallback with token+repo routes directly to .active.
        } catch WebAuthError.cancelled {
            // Browser dismissed — SetupView's refreshSetupStatus will check GitHub directly.
        }
        // needs_setup=1 callback: handleCallback set pendingSetupLogin and returned normally.
        // Other errors (serverError, missingCode) propagate to SetupView for display.
    }

    /// Activates the session directly when both the repo and App installation have been
    /// verified via GitHub's API, without requiring a fresh OAuth round-trip. Used by SetupView
    /// when returning users are blocked by an expired server session — their token is valid
    /// (proven by the API checks that just succeeded) so we can set state without re-running OAuth.
    func activateDirectly(for login: String) async {
        pendingSetupLogin = nil
        selectedRepo = "\(login)/coach-\(login)"
        sessionExpired = false
        isAuthenticated = true
        if user == nil { await fetchUser() }
        isSessionReady = true
    }

    /// Whether the coach-phelps GitHub App is installed and has access to `coach-<login>`.
    /// Calls GitHub directly (no server session dependency) so it works for returning users
    /// whose server session has expired.
    ///
    /// Returns `true` (installed), `false` (confirmed not installed), or `nil` (check failed —
    /// network error or token rejection). Callers must distinguish nil from false: nil means
    /// "we couldn't verify" and should surface an error rather than showing the install UI.
    func coachAppInstalled(for login: String) async -> Bool? {
        guard let token = await validToken() else { return nil }
        guard let url = URL(string: "https://api.github.com/user/installations") else { return nil }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return nil }
            // Non-200 means the token was rejected or the API is unavailable — not "not installed".
            guard http.statusCode == 200 else {
                print("coachAppInstalled: installations API returned HTTP \(http.statusCode)")
                return nil
            }
            let result = try JSONDecoder().decode(AppInstallationsResponse.self, from: data)

            guard let installation = result.installations.first(where: { $0.appSlug == "coach-phelps" }) else {
                return false  // confirmed: App not installed
            }
            // "all" selection covers every repo the user owns.
            if installation.repositorySelection == "all" { return true }

            // "selected" — confirm the coach-<login> repo is in the allowed list.
            guard let reposURL = URL(string: "https://api.github.com/user/installations/\(installation.id)/repositories") else {
                return nil
            }
            var reposRequest = URLRequest(url: reposURL)
            reposRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            reposRequest.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            let (reposData, reposResponse) = try await URLSession.shared.data(for: reposRequest)
            guard let reposHttp = reposResponse as? HTTPURLResponse, reposHttp.statusCode == 200 else {
                print("coachAppInstalled: repos API returned non-200")
                return nil
            }
            let repos = try JSONDecoder().decode(AppInstallationReposResponse.self, from: reposData)
            return repos.repositories.contains { $0.name.lowercased() == "coach-\(login)".lowercased() }
        } catch {
            print("coachAppInstalled check failed: \(error)")
            return nil  // network/decode failure — unknown state, not confirmed absence
        }
    }

    /// Whether `coach-<login>` exists on GitHub (repo created, install may still be pending).
    func coachRepoExists(for login: String) async -> Bool {
        guard let token = await validToken() else { return false }
        let repoFull = "\(login)/coach-\(login)"
        guard let url = URL(string: "https://api.github.com/repos/\(repoFull)") else { return false }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    /// Call with any raw error string a fetch surfaces - flips `sessionExpired` on the same
    /// signal `UserFacingError.friendlyAPIError` already matches (kept in sync with it: a
    /// `requestFailed`/`commitFailed` 401 reads "HTTP 401", `GitHubAPIError.notAuthenticated`
    /// itself reads "Not signed in to GitHub"), so every screen ends up at the same recovery
    /// screen instead of reimplementing detection.
    func noteAPIError(_ raw: String?) {
        guard let raw,
              raw.contains("HTTP 401") || raw.contains("Not authenticated") || raw.contains("Not signed in to GitHub")
        else { return }
        sessionExpired = true
    }

    /// True when navigation landed on the athlete's coach repo page after template create.
    func isCoachRepoCreationURL(_ url: URL, login: String) -> Bool {
        guard url.host?.lowercased() == "github.com" else { return false }
        let parts = url.path.split(separator: "/").map(String.init)
        guard parts.count >= 2 else { return false }
        let ownerMatches = parts[0].caseInsensitiveCompare(login) == .orderedSame
        let repoMatches = parts[1].caseInsensitiveCompare("coach-\(login)") == .orderedSame
        return ownerMatches && repoMatches
    }

    private func runAuthSession(path: String) async throws {
        guard var components = URLComponents(string: Secrets.dashboardBaseURL + path) else {
            throw AuthError.invalidBaseURL
        }
        components.queryItems = [URLQueryItem(name: "platform", value: "ios")]
        guard let authURL = components.url else {
            throw AuthError.invalidBaseURL
        }

        let callbackURL = try await WebAuthPresenter.shared.start(
            url: authURL,
            callbackScheme: callbackScheme
        )

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
            // Server now includes the GitHub token so we can fetch user.id before the
            // install step. isAuthenticated must be false — no coach-phelps installation yet.
            // Explicitly clear it: init() may have set it to true when a stored token was
            // found, and it must not stay true while pendingSetupLogin is set.
            isAuthenticated = false
            if let token = value("token") {
                // token + refresh_token/expires_at arrive together in this same callback -
                // write them in one saveTokens() call, not two, so a kill between separate
                // writes can't pair this new access token with whatever refresh token (stale,
                // wrong-account, or none) was in Keychain before.
                if let rt = value("refresh_token"), let expiresAtRaw = value("expires_at"),
                   let expiresAtMs = Double(expiresAtRaw) {
                    saveTokens(accessToken: token, refreshToken: rt, expiresAt: Date(timeIntervalSince1970: expiresAtMs / 1000))
                } else {
                    saveToken(token)
                }
                await fetchUser()
            }
            pendingSetupLogin = value("login")
            isSessionReady = true
            return
        }

        guard let token = value("token") else {
            throw AuthError.missingCode
        }
        // Same single-write reasoning as the needs_setup branch above.
        if let refreshToken = value("refresh_token"), let expiresAtRaw = value("expires_at"),
           let expiresAtMs = Double(expiresAtRaw) {
            saveTokens(accessToken: token, refreshToken: refreshToken, expiresAt: Date(timeIntervalSince1970: expiresAtMs / 1000))
        } else {
            saveToken(token)
        }
        pendingSetupLogin = nil
        isAuthenticated = true
        sessionExpired = false

        if let repo = value("repo") {
            selectedRepo = repo
            isSessionReady = false
            await fetchUser()
            normalizeSelectedRepo()
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
        lastNetworkError = nil
        await fetchUser()
        normalizeSelectedRepo()
        await resolveRepoIfNeeded()
        normalizeSelectedRepo()
        // 2+ repos granted (ADR 0019) - block with a distinct message, never fall into Setup;
        // the account already has a coach-phelps repo, it just also has extras.
        if multipleReposDetected {
            isSessionReady = true
            return
        }
        if selectedRepo == nil {
            pendingSetupLogin = user?.login
        } else {
            // Repo resolved — clear any lingering setup state so deriveState() routes
            // to .active. Without this, a needs_setup=1 callback that set pendingSetupLogin
            // would keep the app stuck on SetupView even after the installation completes
            // and resolveRepoIfNeeded() finds the repo.
            pendingSetupLogin = nil
        }
        // Token present but user and repo both unresolvable — stale or revoked token.
        // signOut() clears the keychain so the next launch gets a clean LoginView
        // instead of looping on the same failure.
        if selectedRepo == nil && pendingSetupLogin == nil {
            signOut()
            return
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
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return }
            if http.statusCode == 409,
               let result = try? JSONDecoder().decode(RepoResolution.self, from: data),
               result.reason == "multiple_repos_granted" {
                multipleReposDetected = true
                return
            }
            // Non-2xx responses (e.g. 401 token rejected by server) return an error body
            // that won't decode as RepoResolution — treat them as no-repo-found rather than
            // silently discarding. selectedRepo stays nil and bootstrapSession routes
            // to pendingSetupLogin or zombie-token cleanup as appropriate.
            guard (200..<300).contains(http.statusCode) else {
                print("list-my-repos HTTP \(http.statusCode) — treating as unresolved")
                return
            }
            if let result = try? JSONDecoder().decode(RepoResolution.self, from: data) {
                selectedRepo = result.repoFullName
                normalizeSelectedRepo()
            }
        } catch {
            lastNetworkError = "Couldn't look up your repo just now - check your connection and try again."
            print("Failed to resolve repo: \(error)")
        }
    }

    /// Ensures `selectedRepo` is always `owner/repo` once the GitHub login is known.
    private func normalizeSelectedRepo() {
        guard let full = repoFullName else { return }
        if selectedRepo != full { selectedRepo = full }
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

    let refreshTokenKeychainKey = "com.siblingshipyard.coachhq.github.refresh_token"
    let expiresAtKeychainKey = "com.siblingshipyard.coachhq.github.expires_at"

    private func loadKeychainString(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil } // genuinely no item saved - expected, not an error
        guard status == errSecSuccess else {
            print("[GitHubAuthManager] Keychain read failed unexpectedly: \(status) for key \(key)")
            return nil
        }
        guard let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func saveKeychainString(_ value: String, for key: String) {
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            // These are GitHub auth tokens (incl. a 6-month refresh token) - keep them off
            // iCloud Keychain sync/backup entirely, not just behind device passcode.
            // AfterFirstUnlock (not WhenUnlocked): WhenUnlockedThisDeviceOnly requires the
            // device unlocked at the exact instant of the Keychain call, so a cold launch via
            // Background App Refresh / push / widget before the device's first unlock since
            // boot fails with errSecInteractionNotAllowed - previously read back silently as
            // "no token" (see loadKeychainString above). AfterFirstUnlockThisDeviceOnly only
            // needs one unlock since boot and is Apple's recommended class for
            // background-refreshable session tokens, while staying device-only/non-syncing.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
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

    /// All three token fields live in one Keychain item under `keychainKey`, JSON-encoded, so
    /// a refresh persists them with a single `saveKeychainString` call - no window between
    /// separate writes where a process kill could pair a new access token with the old
    /// refresh token (that mismatch permanently fails every future refresh; see #551).
    struct StoredTokens: Codable, Equatable {
        let accessToken: String
        let refreshToken: String?
        let expiresAt: Date?
    }

    /// Reads the combined item; falls back to the pre-#551 format (bare access token string
    /// under `keychainKey`, refresh token + expiry under their own keys) so athletes signed in
    /// before this shipped aren't forced to re-auth. Never deletes the legacy keys itself -
    /// `saveStoredTokens` does that once something writes the combined item.
    func loadStoredTokens() -> StoredTokens? {
        guard let raw = loadKeychainString(keychainKey) else { return nil }
        if let data = raw.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(StoredTokens.self, from: data) {
            return decoded
        }
        let legacyRefresh = loadKeychainString(refreshTokenKeychainKey)
        let legacyExpiresAt = loadKeychainString(expiresAtKeychainKey)
            .flatMap(Double.init)
            .map { Date(timeIntervalSince1970: $0) }
        return StoredTokens(accessToken: raw, refreshToken: legacyRefresh, expiresAt: legacyExpiresAt)
    }

    func saveStoredTokens(_ tokens: StoredTokens) {
        guard let data = try? JSONEncoder().encode(tokens), let json = String(data: data, encoding: .utf8) else { return }
        saveKeychainString(json, for: keychainKey)
        // Migrated to the combined item above - drop the old separate keys so a future decode
        // failure can't fall back to stale legacy data.
        deleteKeychainString(for: refreshTokenKeychainKey)
        deleteKeychainString(for: expiresAtKeychainKey)
    }

    func loadToken() -> String? {
        loadStoredTokens()?.accessToken
    }

    private func saveToken(_ token: String) {
        let current = loadStoredTokens()
        saveStoredTokens(StoredTokens(accessToken: token, refreshToken: current?.refreshToken, expiresAt: current?.expiresAt))
    }

    /// Single-write variant used by performRefreshAccessToken() and handleCallback() - all 3
    /// fields are already known together at both call sites, so there's no need for the
    /// read-then-merge saveToken() does for its own standalone (token-only) call sites.
    private func saveTokens(accessToken: String, refreshToken: String, expiresAt: Date) {
        saveStoredTokens(StoredTokens(accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt))
    }

    private func loadRefreshToken() -> String? {
        loadStoredTokens()?.refreshToken
    }

    private func loadExpiresAt() -> Date? {
        loadStoredTokens()?.expiresAt
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
            let (data, response) = try await performRefreshRequest(request)
            guard let http = response as? HTTPURLResponse else { return nil }
            guard http.statusCode == 200 else {
                if http.statusCode == 502 {
                    // network_error from ui/api/auth/[...action].ts - transient upstream
                    // failure, not a dead credential. Retry once before giving up, same
                    // style as WidgetSnapshotStore's retry-once-on-notAuthenticated.
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    let (retryData, retryResponse) = try await performRefreshRequest(request)
                    guard let retryHttp = retryResponse as? HTTPURLResponse, retryHttp.statusCode == 200 else {
                        return nil
                    }
                    let result = try JSONDecoder().decode(RefreshResponse.self, from: retryData)
                    saveTokens(accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: Date().addingTimeInterval(result.expiresIn))
                    return result.accessToken
                }
                // 401 (refresh_failed) or anything else non-200: terminal, fail immediately.
                return nil
            }
            let result = try JSONDecoder().decode(RefreshResponse.self, from: data)
            saveTokens(accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: Date().addingTimeInterval(result.expiresIn))
            return result.accessToken
        } catch {
            print("Token refresh failed: \(error)")
            return nil
        }
    }

    private func performRefreshRequest(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await URLSession.shared.data(for: request)
    }

    func signOut() {
        TimelineBuffer.shared.clearOnSignOut()

        deleteKeychainString(for: keychainKey)
        deleteKeychainString(for: refreshTokenKeychainKey)
        deleteKeychainString(for: expiresAtKeychainKey)
        isAuthenticated = false
        isSessionReady = true
        user = nil
        selectedRepo = nil
        pendingSetupLogin = nil
        lastNetworkError = nil
        sessionExpired = false
        multipleReposDetected = false

        // Forces a real GitHub login on the next sign-in instead of a silent re-auth via
        // the shared WKWebView's surviving session cookie. Temporary, for multi-account
        // testing - see issue #239 to restore the normal silent-reauth behavior after.
        Task { await WebAuthBrowserStore.clearGitHubSession() }
    }

    /// Called from the blocked screen after the athlete says they've removed access to the
    /// extra repos in GitHub's settings - re-resolves instead of leaving them stuck on the
    /// same screen with no way back in short of force-quitting the app.
    func retryAfterMultipleRepos() async {
        multipleReposDetected = false
        await bootstrapSession()
    }

    /// Called once on first launch after a fresh install. UserDefaults is cleared on app
    /// deletion but Keychain is not, so a reinstall would otherwise inherit a stale token.
    static func clearKeychainOnFreshInstall() {
        let keys = [
            "com.siblingshipyard.coachhq.github.token",
            "com.siblingshipyard.coachhq.github.refresh_token",
            "com.siblingshipyard.coachhq.github.expires_at",
        ]
        for key in keys {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrAccount as String: key,
            ]
            SecItemDelete(query as CFDictionary)
        }
    }
}

// MARK: - Supporting Types

struct GitHubUser: Codable {
    let id: Int?
    let login: String
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case id
        case login
        case avatarUrl = "avatar_url"
    }
}

private struct AppInstallationsResponse: Codable {
    let installations: [AppInstallation]
}

private struct AppInstallation: Codable {
    let id: Int
    let appSlug: String
    let repositorySelection: String

    enum CodingKeys: String, CodingKey {
        case id
        case appSlug = "app_slug"
        case repositorySelection = "repository_selection"
    }
}

private struct AppInstallationReposResponse: Codable {
    let repositories: [AppInstallationRepo]

    struct AppInstallationRepo: Codable {
        let name: String
    }
}

private struct RepoResolution: Codable {
    let repoFullName: String?
    /// Set to "multiple_repos_granted" on the 409 case (ADR 0019) - distinguishes "2+ repos
    /// granted, blocked" from "no repo yet, needs setup" so the app can show the right message.
    let reason: String?

    enum CodingKeys: String, CodingKey {
        case repoFullName = "repo_full_name"
        case reason
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
