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
        manager.signOut(reason: .userLogout)
        return manager
    }

    @MainActor
    override func tearDown() async throws {
        // Best-effort clean; may no-op when Keychain is unavailable (CI).
        GitHubAuthManager().signOut(reason: .userLogout)
        try await super.tearDown()
    }

    @MainActor
    func testFreshInstallClearReportsOnlyDeletedCredentials() throws {
        let manager = try prepareKeychainManager()
        XCTAssertFalse(GitHubAuthManager.clearKeychainOnFreshInstall())

        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_test123",
            refreshToken: "ghr_test456",
            expiresAt: Date(timeIntervalSince1970: 1_800_000_000)
        ))
        XCTAssertTrue(GitHubAuthManager.clearKeychainOnFreshInstall())
        XCTAssertNil(manager.loadStoredTokens())
        XCTAssertFalse(GitHubAuthManager.clearKeychainOnFreshInstall())
    }

    @MainActor
    func testBootstrapKeepsSessionAcrossNetworkAndServerFailuresThenRetries() async {
        let manager = GitHubAuthManager()
        manager.isAuthenticated = true
        manager.bootstrapTokenProvider = { ("gho_test", false) }
        manager.dataRequestHandler = { _ in throw URLError(.notConnectedToInternet) }

        await manager.bootstrapSession()
        XCTAssertTrue(manager.isAuthenticated)
        XCTAssertTrue(manager.bootstrapNeedsRetry)
        let router = AppRouter(authManager: manager)
        router.deriveState()
        XCTAssertEqual(router.state, .sessionUnavailable)

        manager.dataRequestHandler = { request in
            let isUser = request.url?.host == "api.github.com"
            let data = Data((isUser
                ? #"{"id":1,"login":"sky"}"#
                : #"{"repo_full_name":"sky/coach-sky"}"#).utf8)
            return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        await manager.bootstrapSession()
        router.deriveState()
        XCTAssertFalse(manager.bootstrapNeedsRetry)
        XCTAssertEqual(router.state, .active)
    }

    @MainActor
    func testBootstrapOnlyClearsOnConfirmedProfileRejection() async {
        for status in [200, 401, 404, 502] {
            let manager = GitHubAuthManager()
            manager.isAuthenticated = true
            manager.bootstrapTokenProvider = { ("gho_test", false) }
            manager.dataRequestHandler = { request in
                (Data(), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
            }
            await manager.bootstrapSession()
            XCTAssertEqual(manager.isAuthenticated, status != 401)
            XCTAssertEqual(manager.bootstrapNeedsRetry, status != 401)
        }
    }

    @MainActor
    func testBootstrapDoesNotClearAfterTransientRefreshFailureAndStaleAccessToken401() async {
        let manager = GitHubAuthManager()
        manager.isAuthenticated = true
        manager.bootstrapTokenProvider = { ("gho_expired", true) }
        manager.dataRequestHandler = { request in
            (Data(), HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!)
        }

        await manager.bootstrapSession()
        XCTAssertTrue(manager.isAuthenticated)
        XCTAssertTrue(manager.bootstrapNeedsRetry)
    }

    @MainActor
    func testBootstrapRoutesNoRepoAndMultipleReposWithoutClearingToken() async {
        for (status, body, expectedState) in [
            (200, #"{"repo_full_name":null,"reason":"no_owned_repos"}"#, AppState.needsSetup(login: "sky")),
            (401, "{}", AppState.needsSetup(login: "sky")),
            (409, #"{"reason":"multiple_repos_granted"}"#, AppState.multipleReposGranted)
        ] {
            let manager = GitHubAuthManager()
            manager.isAuthenticated = true
            manager.bootstrapTokenProvider = { ("gho_test", false) }
            manager.dataRequestHandler = { request in
                let isUser = request.url?.host == "api.github.com"
                let data = Data((isUser ? #"{"id":1,"login":"sky"}"# : body).utf8)
                let response = HTTPURLResponse(url: request.url!, statusCode: isUser ? 200 : status, httpVersion: nil, headerFields: nil)!
                return (data, response)
            }
            await manager.bootstrapSession()
            let router = AppRouter(authManager: manager)
            router.deriveState()
            XCTAssertTrue(manager.isAuthenticated)
            XCTAssertEqual(router.state, expectedState)
        }
    }

    @MainActor
    func testBootstrapPreservesSessionWhenRepoLookupFailsOrCannotDecode() async {
        for (status, body) in [(502, "{}"), (200, "not-json")] {
            let manager = GitHubAuthManager()
            manager.isAuthenticated = true
            manager.bootstrapTokenProvider = { ("gho_test", false) }
            manager.dataRequestHandler = { request in
                let isUser = request.url?.host == "api.github.com"
                let data = Data((isUser ? #"{"id":1,"login":"sky"}"# : body).utf8)
                let response = HTTPURLResponse(url: request.url!, statusCode: isUser ? 200 : status, httpVersion: nil, headerFields: nil)!
                return (data, response)
            }
            await manager.bootstrapSession()
            XCTAssertTrue(manager.isAuthenticated)
            XCTAssertTrue(manager.bootstrapNeedsRetry)
        }
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

    // #1078 I4/I5/I9 capture coverage — TimelineBuffer asserts (Sentry itself is gated off in tests).
    @MainActor
    func testValidTokenSoftFallbackCapturesOneWarningPerAttemptCycle() async throws {
        let manager = try prepareKeychainManager()
        manager.refreshBackoffNanoseconds = 0
        TimelineBuffer.shared.clearOnSignOut()
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
                statusCode: 502,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(), response)
        }

        let token = await manager.validToken()

        XCTAssertEqual(token, "gho_old")
        // 1 initial + refreshTransientExtraAttempts retries = one attempt-cycle.
        XCTAssertEqual(calls, 1 + GitHubAuthManager.refreshTransientExtraAttempts)
        let softFallbackEvents = TimelineBuffer.shared.getEvents().filter {
            $0.message == GitHubAuthManager.refreshSoftFallbackMessage
        }
        XCTAssertEqual(softFallbackEvents.count, 1, "I4: one warning per failed refresh attempt-cycle")
        XCTAssertEqual(softFallbackEvents.first?.category, "github.auth.refresh")
        XCTAssertEqual(softFallbackEvents.first?.metadata["outcome"], "soft_fallback")
    }

    @MainActor
    func testValidTokenSoftFallbackCapturesOnceOnTerminal401() async throws {
        let manager = try prepareKeychainManager()
        manager.refreshBackoffNanoseconds = 0
        TimelineBuffer.shared.clearOnSignOut()
        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_old",
            refreshToken: "ghr_old",
            expiresAt: Date().addingTimeInterval(-60)
        ))

        manager.refreshRequestHandler = { _ in
            let response = HTTPURLResponse(
                url: URL(string: "https://example.com/api/auth/refresh")!,
                statusCode: 401,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(), response)
        }

        _ = await manager.validToken()

        let softFallbackEvents = TimelineBuffer.shared.getEvents().filter {
            $0.message == GitHubAuthManager.refreshSoftFallbackMessage
        }
        XCTAssertEqual(softFallbackEvents.count, 1)
        XCTAssertEqual(softFallbackEvents.first?.metadata["reason"], "http_401")
    }

    func testKeychainStatusHelpersDistinguishExpectedFailures() {
        XCTAssertFalse(GitHubAuthManager.isKeychainDeleteFailure(errSecSuccess))
        XCTAssertFalse(GitHubAuthManager.isKeychainDeleteFailure(errSecItemNotFound))
        XCTAssertTrue(GitHubAuthManager.isKeychainDeleteFailure(errSecMissingEntitlement))
        XCTAssertFalse(GitHubAuthManager.isKeychainAddFailure(errSecSuccess))
        XCTAssertTrue(GitHubAuthManager.isKeychainAddFailure(errSecMissingEntitlement))
        XCTAssertTrue(GitHubAuthManager.isKeychainAddFailure(errSecDuplicateItem))
    }

    @MainActor
    func testSaveStoredTokensCapturesKeychainWriteFailureWhenAddFails() throws {
        // Inverse of prepareKeychainManager: only runnable where Keychain writes are
        // structurally unavailable (CI). On a signed device/simulator, SecItemAdd succeeds
        // and there is nothing failed to assert.
        let canaryKey = "com.siblingshipyard.coachhq.github.tests.keychain_canary_fail"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: canaryKey,
            kSecValueData as String: Data([1]),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemDelete(query as CFDictionary)
        let canaryStatus = SecItemAdd(query as CFDictionary, nil)
        SecItemDelete(query as CFDictionary)
        guard canaryStatus != errSecSuccess else {
            throw XCTSkip("Keychain writes succeed here — cannot force SecItemAdd failure for I5 capture assertion.")
        }

        let manager = GitHubAuthManager()
        TimelineBuffer.shared.clearOnSignOut()
        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_unwritable",
            refreshToken: "ghr_unwritable",
            expiresAt: Date().addingTimeInterval(3600)
        ))

        let keychainEvents = TimelineBuffer.shared.getEvents().filter {
            $0.message == GitHubAuthManager.keychainWriteFailedMessage
                && $0.category == "github.auth.keychain"
        }
        XCTAssertFalse(keychainEvents.isEmpty, "I5: failed Keychain write must capture")
        XCTAssertTrue(keychainEvents.contains { $0.metadata["step"] == "add" })
    }

    @MainActor
    func testFetchUserCapturesOnRequestFailure() async throws {
        let manager = try prepareKeychainManager()
        TimelineBuffer.shared.clearOnSignOut()
        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_ok",
            refreshToken: "ghr_ok",
            expiresAt: Date().addingTimeInterval(3600)
        ))

        manager.dataRequestHandler = { _ in
            throw URLError(.notConnectedToInternet)
        }

        await manager.fetchUser()

        let events = TimelineBuffer.shared.getEvents().filter {
            $0.category == "github.auth.fetch_user" && $0.message == "failed"
        }
        XCTAssertEqual(events.count, 1, "I9: fetchUser failure must capture")
        XCTAssertNotNil(manager.lastNetworkError)
    }

    @MainActor
    func testCoachAppInstalledCapturesOnInstallationsHTTPFailure() async throws {
        let manager = try prepareKeychainManager()
        TimelineBuffer.shared.clearOnSignOut()
        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_ok",
            refreshToken: "ghr_ok",
            expiresAt: Date().addingTimeInterval(3600)
        ))

        manager.dataRequestHandler = { _ in
            let response = HTTPURLResponse(
                url: URL(string: "https://api.github.com/user/installations")!,
                statusCode: 503,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(), response)
        }

        let installed = await manager.coachAppInstalled(for: "alice")

        XCTAssertNil(installed)
        let events = TimelineBuffer.shared.getEvents().filter {
            $0.category == "github.auth.coach_app_installed"
                && $0.message == "coachAppInstalled: installations API failed"
        }
        XCTAssertEqual(events.count, 1, "I9: coachAppInstalled HTTP failure must capture")
        XCTAssertEqual(events.first?.metadata["http_status"], "503")
    }

    @MainActor
    func testCoachRepoExistsReturnsNilAndCapturesOnHTTPFault() async throws {
        let manager = try prepareKeychainManager()
        TimelineBuffer.shared.clearOnSignOut()
        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_ok",
            refreshToken: "ghr_ok",
            expiresAt: Date().addingTimeInterval(3600)
        ))

        manager.dataRequestHandler = { _ in
            let response = HTTPURLResponse(
                url: URL(string: "https://api.github.com/repos/alice/coach-alice")!,
                statusCode: 503,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(), response)
        }

        let exists = await manager.coachRepoExists(for: "alice")

        XCTAssertNil(exists)
        let events = TimelineBuffer.shared.getEvents().filter {
            $0.category == "github.auth.coach_repo_exists"
                && $0.message == "coachRepoExists: repos API failed"
        }
        XCTAssertEqual(events.count, 1, "coachRepoExists HTTP failure must capture")
        XCTAssertEqual(events.first?.metadata["http_status"], "503")
    }

    @MainActor
    func testCoachRepoExistsReturnsFalseOn404() async throws {
        let manager = try prepareKeychainManager()
        TimelineBuffer.shared.clearOnSignOut()
        manager.saveStoredTokens(GitHubAuthManager.StoredTokens(
            accessToken: "gho_ok",
            refreshToken: "ghr_ok",
            expiresAt: Date().addingTimeInterval(3600)
        ))

        manager.dataRequestHandler = { _ in
            let response = HTTPURLResponse(
                url: URL(string: "https://api.github.com/repos/alice/coach-alice")!,
                statusCode: 404,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(), response)
        }

        let exists = await manager.coachRepoExists(for: "alice")
        XCTAssertEqual(exists, false)
        let events = TimelineBuffer.shared.getEvents().filter {
            $0.category == "github.auth.coach_repo_exists"
        }
        XCTAssertTrue(events.isEmpty, "404 is confirmed absence — no capture")
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
