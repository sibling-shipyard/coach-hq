import Foundation
import Combine
import AuthenticationServices
import Security

/// Manages GitHub OAuth 2.0 authentication flow and token storage.
@MainActor
class GitHubAuthManager: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published var isAuthenticated = false
    @Published var user: GitHubUser?
    @Published var selectedRepo: String?

    private let keychainKey = "com.coachphelps.github.token"

    // MARK: - OAuth Configuration
    // Register your own GitHub OAuth App at: https://github.com/settings/developers
    // The client secret is NOT committed to this repo (this repo is public) — supply your
    // own via Secrets.swift (gitignored; copy Secrets.swift.example and fill in your values).
    private let clientId = Secrets.githubClientId
    private let clientSecret = Secrets.githubClientSecret
    private let callbackScheme = "coachphelps"
    private let scopes = "repo"

    override init() {
        super.init()
        // Check for existing token on launch
        if let _ = loadToken() {
            isAuthenticated = true
            Task {
                await fetchUser()
                await discoverRepo()
            }
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

    /// Initiates the GitHub OAuth flow via ASWebAuthenticationSession
    func signIn() async throws {
        let authURL = URL(string: "https://github.com/login/oauth/authorize?client_id=\(clientId)&scope=\(scopes)&redirect_uri=\(callbackScheme)://callback")!

        let code = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: self.callbackScheme
            ) { url, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let url = url,
                          let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                            .queryItems?.first(where: { $0.name == "code" })?.value {
                    continuation.resume(returning: code)
                } else {
                    continuation.resume(throwing: AuthError.missingCode)
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            session.start()
        }

        // Exchange code for access token
        let token = try await exchangeCodeForToken(code: code)
        saveToken(token)
        isAuthenticated = true
        await fetchUser()
        await discoverRepo()
    }

    /// Exchanges the OAuth authorization code for an access token
    private func exchangeCodeForToken(code: String) async throws -> String {
        var request = URLRequest(url: URL(string: "https://github.com/login/oauth/access_token")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = [
            "client_id": clientId,
            "client_secret": clientSecret,
            "code": code
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, _) = try await URLSession.shared.data(for: request)
        let response = try JSONDecoder().decode(TokenResponse.self, from: data)

        guard let token = response.accessToken else {
            throw AuthError.tokenExchangeFailed
        }
        return token
    }

    // MARK: - User & Repo Discovery

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

    /// Auto-discovers the coach-phelps repo by convention, or lists repos for selection
    func discoverRepo() async {
        guard let token = loadToken(), let username = user?.login else { return }

        // Try convention-based discovery
        let conventionNames = ["coach-phelps", "coach-phelps-template"]
        for name in conventionNames {
            let url = URL(string: "https://api.github.com/repos/\(username)/\(name)")!
            var request = URLRequest(url: url)
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            if let (_, response) = try? await URLSession.shared.data(for: request),
               let httpResponse = response as? HTTPURLResponse,
               httpResponse.statusCode == 200 {
                selectedRepo = name
                return
            }
        }

        // If convention fails, user will need to pick from repo list (handled in UI)
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
        user = nil
        selectedRepo = nil
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

struct TokenResponse: Codable {
    let accessToken: String?
    let tokenType: String?
    let scope: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case scope
    }
}

enum AuthError: Error, LocalizedError {
    case missingCode
    case tokenExchangeFailed

    var errorDescription: String? {
        switch self {
        case .missingCode: return "No authorization code received from GitHub."
        case .tokenExchangeFailed: return "Failed to exchange code for access token."
        }
    }
}
