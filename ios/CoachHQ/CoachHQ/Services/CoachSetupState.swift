import Foundation

/// Tracks whether the athlete finished first-session Coach intake for a repo.
/// Until true, the app opens Chat — not Home — after GitHub setup completes.
enum CoachSetupState {
    private static func storageKey(repoFullName: String) -> String {
        "coachSetupComplete.\(repoFullName.replacingOccurrences(of: "/", with: "_"))"
    }

    static func isComplete(repoFullName: String?) -> Bool {
        guard let repoFullName, !repoFullName.isEmpty else { return false }
        return UserDefaults.standard.bool(forKey: storageKey(repoFullName: repoFullName))
    }

    static func markComplete(repoFullName: String) {
        UserDefaults.standard.set(true, forKey: storageKey(repoFullName: repoFullName))
    }
}

/// Resolves whether a fresh app launch should open Chat or Home. Defers the decision until
/// chat history is loaded so existing athletes are not sent to Chat after upgrade.
enum CoachSetupBootstrap {
    /// `true` → open Chat first (new athlete, no history). `false` → Home (intake done or history exists).
    @MainActor
    static func shouldOpenChatFirst(authManager: GitHubAuthManager) async -> Bool {
        if CoachSetupState.isComplete(repoFullName: authManager.repoFullName) {
            return false
        }
        guard let repo = authManager.repoFullName, authManager.isSessionReady else {
            return false
        }

        let client = CoachChatAPIClient(authManager: authManager)
        if let threads = try? await client.fetchThreads() {
            let active = threads.filter { $0.status != .deleted }
            if !active.isEmpty {
                CoachSetupState.markComplete(repoFullName: repo)
                return false
            }
        }
        return true
    }
}
