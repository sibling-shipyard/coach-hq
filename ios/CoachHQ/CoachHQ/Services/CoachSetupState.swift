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

/// Resolves whether a fresh app launch should open Chat or Home.
///
/// B3: previously inferred completion from "does any chat thread exist" - wrong signal, since a
/// thread existing has never meant the First Session Protocol actually finished (an athlete who
/// answered a couple of intake questions then killed the app already had a thread, but a blank
/// Athlete Profile). Now asks the server directly (B2's /api/coach-chat-profile-status, backed by
/// parsing state.md's Athlete Profile section) every launch while the local flag is still false,
/// and only trusts the fast local Keychain path once that's genuinely true.
enum CoachSetupBootstrap {
    /// Splash-appropriate cap on the network fallback below - CoachChatAPIClient has no
    /// per-request timeout override anywhere (URLSession.shared's default is 60s), and a stalled
    /// connection here would leave the splash screen static with no progress indicator for up to
    /// a full minute. 5s is generous for a same-region API call; on a timeout this falls back to
    /// Home ("couldn't determine, don't assume new athlete" - never trap a returning athlete in
    /// Chat just because one network call was slow).
    private static let networkCheckTimeoutSeconds: Double = 5

    /// Races `operation` against a timeout; whichever finishes first wins, the other is
    /// cancelled. Returns nil on timeout or if `operation` itself returns nil.
    private static func withTimeout<T: Sendable>(
        seconds: Double,
        operation: @escaping @Sendable () async -> T?
    ) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { await operation() }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                return nil
            }
            let result = await group.next() ?? nil
            group.cancelAll()
            return result
        }
    }

    /// `true` → open Chat first (First Session Protocol not yet complete). `false` → Home.
    @MainActor
    static func shouldOpenChatFirst(authManager: GitHubAuthManager) async -> Bool {
        // Fast path: once genuinely complete, never pay the network round trip again.
        if CoachSetupState.isComplete(repoFullName: authManager.repoFullName) {
            return false
        }
        guard let repo = authManager.repoFullName, authManager.isSessionReady else {
            return false
        }

        let client = CoachChatAPIClient(authManager: authManager)
        let profileComplete = await withTimeout(seconds: networkCheckTimeoutSeconds) {
            try? await client.profileStatus()
        }
        if profileComplete == true {
            CoachSetupState.markComplete(repoFullName: repo)
            OnboardingHints.clear() // B1: no longer needed once the real profile is written
            return false
        }
        // nil (timeout/network failure) or false: fall back to Home on nil (see doc comment
        // above), open Chat on a confirmed false.
        return profileComplete == false
    }
}
