import Foundation

/// B1: sport(s) + goal collected in native onboarding (the "season" step), cached locally only -
/// never committed to the repo. The old approach committed a `user_data/profile.md` file that
/// had zero consumers anywhere (confirmed via repo-wide search - neither the chat backend nor
/// SOUL.md ever read it). Used instead to seed Coach's chat-based First Session Protocol intake
/// with a pre-filled hint so it can reflect the athlete's picks back for confirmation rather than
/// asking cold - see B4's platform/soul/B_engine.md edit.
///
/// UserDefaults, not Keychain - this is a soft hint, not athlete identity. No TTL/expiry:
/// UserDefaults persists indefinitely on-device until cleared, and there's no harm in a hint
/// surviving a week of inactivity. If it's absent (reinstall, or the athlete does First Session
/// via web instead), the protocol just asks fresh - graceful degradation, not an error case.
enum OnboardingHints {
    private static let sportsKey = "onboardingHintSports"
    private static let goalKey = "onboardingHintGoal"

    static func save(sports: [String], goal: String) {
        UserDefaults.standard.set(sports, forKey: sportsKey)
        UserDefaults.standard.set(goal, forKey: goalKey)
    }

    static func load() -> (sports: [String], goal: String)? {
        let sports = UserDefaults.standard.array(forKey: sportsKey) as? [String] ?? []
        let goal = UserDefaults.standard.string(forKey: goalKey) ?? ""
        guard !sports.isEmpty || !goal.isEmpty else { return nil }
        return (sports, goal)
    }

    /// Cleared once the First Session Protocol genuinely finishes (state.md's Athlete Profile
    /// section is populated - see B2/B3's profileComplete check) - no longer needed after that.
    static func clear() {
        UserDefaults.standard.removeObject(forKey: sportsKey)
        UserDefaults.standard.removeObject(forKey: goalKey)
    }
}
