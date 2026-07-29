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
