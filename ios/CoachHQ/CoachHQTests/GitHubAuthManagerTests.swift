import XCTest
import Security
@testable import CoachHQ

/// Covers #551's pure-logic fixes: the combined-Keychain-item StoredTokens round trip and the
/// pre-#551 legacy-3-key migration fallback. Does NOT cover the 502-retry/401-fail-immediately
/// branching in performRefreshAccessToken() - that needs a URLSession/URLProtocol mocking seam
/// this test suite doesn't have anywhere yet (grepped: no existing URLProtocol double in
/// CoachHQTests), and adding one is a bigger lift than this fix's scope.
final class GitHubAuthManagerTests: XCTestCase {
    @MainActor
    override func setUp() async throws {
        try await super.setUp()
        GitHubAuthManager().signOut() // clean slate: real Keychain, shared key names
    }

    @MainActor
    override func tearDown() async throws {
        GitHubAuthManager().signOut()
        try await super.tearDown()
    }

    @MainActor
    func testStoredTokensRoundTripsThroughTheCombinedKeychainItem() {
        let manager = GitHubAuthManager()
        let tokens = GitHubAuthManager.StoredTokens(
            accessToken: "gho_test123",
            refreshToken: "ghr_test456",
            expiresAt: Date(timeIntervalSince1970: 1_800_000_000)
        )

        manager.saveStoredTokens(tokens)
        let loaded = manager.loadStoredTokens()

        XCTAssertEqual(loaded, tokens)
    }

    @MainActor
    func testLoadStoredTokensFallsBackToPreFix551LegacyThreeKeyFormat() {
        let manager = GitHubAuthManager()
        // Seed the pre-#551 layout directly (bare access-token string under keychainKey, refresh
        // token + expiry under their own separate keys) - what an athlete who signed in before
        // this shipped already has on disk. loadStoredTokens() must still reconstruct it.
        setKeychainString("gho_legacy789", for: manager.keychainKey)
        setKeychainString("ghr_legacyabc", for: manager.refreshTokenKeychainKey)
        setKeychainString(String(1_800_000_000.0), for: manager.expiresAtKeychainKey)

        let loaded = manager.loadStoredTokens()

        XCTAssertEqual(loaded?.accessToken, "gho_legacy789")
        XCTAssertEqual(loaded?.refreshToken, "ghr_legacyabc")
        XCTAssertEqual(loaded?.expiresAt, Date(timeIntervalSince1970: 1_800_000_000))
    }

    @MainActor
    func testSavingStoredTokensRetiresTheLegacyKeysSoFallbackCantReturnStaleData() {
        let manager = GitHubAuthManager()
        setKeychainString("gho_legacy789", for: manager.refreshTokenKeychainKey)
        setKeychainString(String(1_800_000_000.0), for: manager.expiresAtKeychainKey)

        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_fresh",
            refreshToken: "ghr_fresh",
            expiresAt: Date(timeIntervalSince1970: 1_900_000_000)
        ))

        // If the legacy keys survived, a corrupted future combined-item read could fall back to
        // this stale refresh token/expiry instead of failing cleanly - confirm they're gone.
        XCTAssertNil(readKeychainString(for: manager.refreshTokenKeychainKey))
        XCTAssertNil(readKeychainString(for: manager.expiresAtKeychainKey))
    }

    // MARK: - Raw Keychain helpers (test-only; mirrors GitHubAuthManager's own private
    // saveKeychainString/loadKeychainString so the legacy-format test can seed data without
    // going through the new combined-item write path it's meant to be independent of).

    private func setKeychainString(_ value: String, for key: String) {
        guard let data = value.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    private func readKeychainString(for key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
