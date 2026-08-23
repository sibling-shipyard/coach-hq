import Foundation

/// Name and sports collected in native onboarding, cached locally until the
/// server records them during the First Session Protocol greeting.
///
/// UserDefaults, not Keychain - this is a soft hint, not athlete identity. No TTL/expiry:
/// UserDefaults persists indefinitely on-device until cleared, and there's no harm in a hint
/// surviving a week of inactivity. If it's absent (reinstall, or the athlete does First Session
/// via web instead), the protocol just asks fresh - graceful degradation, not an error case.
enum OnboardingHints {
    private static let nameKey = "onboardingHintName"
    private static let sportsKey = "onboardingHintSports"

    /// Each field is collected on its own screen, so the saves stay independent.
    static func save(name: String) {
        UserDefaults.standard.set(name, forKey: nameKey)
    }

    static func save(sports: [String]) {
        UserDefaults.standard.set(sports, forKey: sportsKey)
    }

    static func load() -> (name: String?, sports: [String])? {
        let name = UserDefaults.standard.string(forKey: nameKey)
        let sports = UserDefaults.standard.array(forKey: sportsKey) as? [String] ?? []
        guard !(name?.isEmpty ?? true) || !sports.isEmpty else { return nil }
        return (name, sports)
    }

    /// Cleared once the First Session Protocol genuinely finishes (see B2/B3's profileComplete
    /// check) - no longer needed after that.
    static func clear() {
        UserDefaults.standard.removeObject(forKey: nameKey)
        UserDefaults.standard.removeObject(forKey: sportsKey)
    }
}
