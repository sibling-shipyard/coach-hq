import Foundation
import Combine

/// Manages test mode state for the app.
///
/// When test mode is enabled, all sync operations target a `test/sync` branch
/// instead of `main`. This allows repeated testing without polluting production data.
///
/// Usage:
///   1. Enable test mode in Settings
///   2. Run sync — data goes to `test/sync` branch
///   3. Inspect results on GitHub
///   4. Tap "Reset Test Branch" to nuke and recreate from `main` HEAD
///   5. Repeat until satisfied
///   6. Disable test mode → next sync goes to `main` (production backfill)
final class TestModeManager: ObservableObject {
    static let shared = TestModeManager()

    private let enabledKey = "testMode_enabled"
    private let testBranchName = "test/sync"

    @Published var isEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isEnabled, forKey: enabledKey)
        }
    }

    var targetBranch: String {
        isEnabled ? testBranchName : "main"
    }

    private init() {
        self.isEnabled = UserDefaults.standard.bool(forKey: enabledKey)
    }

    // MARK: - Branch Management

    /// Creates the test branch from main HEAD. If it already exists, force-resets it.
    func resetTestBranch(authManager: GitHubAuthManager) async throws {
        guard let user = authManager.user?.login,
              let repo = authManager.selectedRepo,
              let token = authManager.loadToken() else {
            throw TestModeError.notAuthenticated
        }

        let base = "https://api.github.com/repos/\(user)/\(repo)"
        let headers = [
            "Authorization": "Bearer \(token)",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        ]

        // 1. Get main HEAD SHA
        let mainRefURL = URL(string: "\(base)/git/ref/heads/main")!
        var mainReq = URLRequest(url: mainRefURL)
        headers.forEach { mainReq.setValue($1, forHTTPHeaderField: $0) }
        let (mainData, mainResp) = try await URLSession.shared.data(for: mainReq)
        guard let mainHttp = mainResp as? HTTPURLResponse, mainHttp.statusCode == 200 else {
            throw TestModeError.failedToGetMainRef
        }
        let mainRef = try JSONDecoder().decode(RefResponse.self, from: mainData)
        let mainSHA = mainRef.object.sha

        // 2. Try to delete existing test branch (ignore 422 "Reference does not exist")
        let deleteURL = URL(string: "\(base)/git/refs/heads/\(testBranchName)")!
        var deleteReq = URLRequest(url: deleteURL)
        deleteReq.httpMethod = "DELETE"
        headers.forEach { deleteReq.setValue($1, forHTTPHeaderField: $0) }
        let (_, deleteResp) = try await URLSession.shared.data(for: deleteReq)
        // 204 = deleted, 422 = didn't exist — both are fine
        if let deleteHttp = deleteResp as? HTTPURLResponse,
           deleteHttp.statusCode != 204 && deleteHttp.statusCode != 422 {
            // Unexpected error
            throw TestModeError.failedToDeleteBranch
        }

        // 3. Create test branch pointing at main HEAD
        let createURL = URL(string: "\(base)/git/refs")!
        var createReq = URLRequest(url: createURL)
        createReq.httpMethod = "POST"
        headers.forEach { createReq.setValue($1, forHTTPHeaderField: $0) }
        createReq.httpBody = try JSONSerialization.data(withJSONObject: [
            "ref": "refs/heads/\(testBranchName)",
            "sha": mainSHA
        ])
        let (_, createResp) = try await URLSession.shared.data(for: createReq)
        guard let createHttp = createResp as? HTTPURLResponse,
              createHttp.statusCode == 201 else {
            throw TestModeError.failedToCreateBranch
        }
    }
}

// MARK: - Supporting Types

enum TestModeError: LocalizedError {
    case notAuthenticated
    case failedToGetMainRef
    case failedToDeleteBranch
    case failedToCreateBranch

    var errorDescription: String? {
        switch self {
        case .notAuthenticated: return "Not authenticated — sign in first."
        case .failedToGetMainRef: return "Could not read main branch HEAD."
        case .failedToDeleteBranch: return "Could not delete existing test branch."
        case .failedToCreateBranch: return "Could not create test branch."
        }
    }
}

private struct RefResponse: Decodable {
    struct Object: Decodable { let sha: String }
    let object: Object
}
