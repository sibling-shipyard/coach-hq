import XCTest
import Security
@testable import CoachHQ

/// Covers #551's pure-logic fixes: the combined-Keychain-item StoredTokens round trip and the
/// pre-#551 legacy-3-key migration fallback. #1069 adds the 502-retry / 401-terminal branching
/// via an injectable `refreshRequestHandler` seam (no URLProtocol needed).
final class GitHubAuthManagerTests: XCTestCase {
    @MainActor
    override func setUp() async throws {
        try await super.setUp()
    }

    /// The GitHub Actions macOS runner's XCTest process has no Keychain entitlement, so every
    /// SecItemAdd here fails with errSecMissingEntitlement (-34018) - confirmed in CI (#551 PR
    /// #552 review). A canary write lets these tests still run for real wherever Keychain access
    /// genuinely works (a signed device/simulator run) while skipping cleanly, not falsely
    /// failing, in an environment that structurally can't support them.
    private func skipIfKeychainWritesAreUnavailable() throws {
        let canaryKey = "com.siblingshipyard.coachhq.github.tests.keychain_canary"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: canaryKey,
            kSecValueData as String: Data([1]),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess else {
            throw XCTSkip("Keychain writes unavailable in this environment (OSStatus \(status)) - cannot exercise real Keychain round-trip/migration behavior here.")
        }
    }

    @MainActor
    private func prepareKeychainManager() throws -> GitHubAuthManager {
        try skipIfKeychainWritesAreUnavailable()
        let manager = GitHubAuthManager()
        manager.signOut()
        return manager
    }

    @MainActor
    override func tearDown() async throws {
        // Best-effort clean; may no-op when Keychain is unavailable (CI).
        GitHubAuthManager().signOut()
        try await super.tearDown()
    }

    func testTransientRefreshStatusIsOnly502() {
        XCTAssertTrue(GitHubAuthManager.isTransientRefreshStatus(502))
        XCTAssertFalse(GitHubAuthManager.isTransientRefreshStatus(401))
        XCTAssertFalse(GitHubAuthManager.isTransientRefreshStatus(200))
        XCTAssertFalse(GitHubAuthManager.isTransientRefreshStatus(503))
        XCTAssertEqual(GitHubAuthManager.refreshTransientExtraAttempts, 2)
    }

    @MainActor
    func testStoredTokensRoundTripsThroughTheCombinedKeychainItem() throws {
        let manager = try prepareKeychainManager()
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
    func testLoadStoredTokensFallsBackToPreFix551LegacyThreeKeyFormat() throws {
        let manager = try prepareKeychainManager()
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
    func testSavingStoredTokensRetiresTheLegacyKeysSoFallbackCantReturnStaleData() throws {
        let manager = try prepareKeychainManager()
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

    @MainActor
    func testValidTokenRetries502ThenPersistsRotatedPair() async throws {
        let manager = try prepareKeychainManager()
        manager.refreshBackoffNanoseconds = 0
        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_old",
            refreshToken: "ghr_old",
            expiresAt: Date().addingTimeInterval(-60)
        ))

        var calls = 0
        manager.refreshRequestHandler = { _ in
            calls += 1
            if calls == 1 {
                let response = HTTPURLResponse(
                    url: URL(string: "https://example.com/api/auth/refresh")!,
                    statusCode: 502,
                    httpVersion: nil,
                    headerFields: nil
                )!
                return (Data(), response)
            }
            let body = """
            {"access_token":"gho_new","refresh_token":"ghr_new","expires_in":28800}
            """.data(using: .utf8)!
            let response = HTTPURLResponse(
                url: URL(string: "https://example.com/api/auth/refresh")!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!
            return (body, response)
        }

        let token = await manager.validToken()

        XCTAssertEqual(token, "gho_new")
        XCTAssertEqual(calls, 2)
        XCTAssertEqual(manager.loadStoredTokens()?.accessToken, "gho_new")
        XCTAssertEqual(manager.loadStoredTokens()?.refreshToken, "ghr_new")
    }

    @MainActor
    func testValidTokenDoesNotRetry401RefreshFailed() async throws {
        let manager = try prepareKeychainManager()
        manager.refreshBackoffNanoseconds = 0
        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_old",
            refreshToken: "ghr_old",
            expiresAt: Date().addingTimeInterval(-60)
        ))

        var calls = 0
        manager.refreshRequestHandler = { _ in
            calls += 1
            let response = HTTPURLResponse(
                url: URL(string: "https://example.com/api/auth/refresh")!,
                statusCode: 401,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(), response)
        }

        let token = await manager.validToken()

        // validToken falls back to the stored access token when refresh fails.
        XCTAssertEqual(token, "gho_old")
        XCTAssertEqual(calls, 1)
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
