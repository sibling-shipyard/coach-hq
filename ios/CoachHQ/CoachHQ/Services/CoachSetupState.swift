import Foundation
import Security

/// Tracks whether the athlete finished first-session Coach intake for a repo.
/// Until true, the app opens Chat — not Home — after GitHub setup completes.
///
/// Backed by Keychain, not UserDefaults - UserDefaults is wiped on app delete/reinstall, which
/// is exactly when shouldOpenChatFirst() below needs this most (it only ever runs on the first
/// launch after an install). Keychain items survive a same-device reinstall, so a returning
/// athlete reinstalling the app gets recognized instantly, no network round trip needed - same
/// kSecAttrAccessibleWhenUnlockedThisDeviceOnly pattern as GitHubAuthManager's token storage
/// (not synced via iCloud Keychain, so a genuinely new physical device still falls through to
/// shouldOpenChatFirst()'s network check below, which is unavoidable - that device has never
/// stored anything about this athlete before).
enum CoachSetupState {
    private static func storageKey(repoFullName: String) -> String {
        "coachSetupComplete.\(repoFullName.replacingOccurrences(of: "/", with: "_"))"
    }

    static func isComplete(repoFullName: String?) -> Bool {
        guard let repoFullName, !repoFullName.isEmpty else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: storageKey(repoFullName: repoFullName)
        ]
        return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }

    static func markComplete(repoFullName: String) {
        let key = storageKey(repoFullName: repoFullName)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: Data([1]),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        SecItemDelete(query as CFDictionary) // Remove existing, mirrors GitHubAuthManager's save pattern
        SecItemAdd(query as CFDictionary, nil)
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
