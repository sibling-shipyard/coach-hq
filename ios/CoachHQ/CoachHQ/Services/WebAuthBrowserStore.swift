import WebKit

/// Single shared WKWebView cookie jar for OAuth sign-in and GitHub setup (repo create +
/// app install). ASWebAuthenticationSession and SFSafariViewController use separate stores —
/// federated login (Google → GitHub) often does not carry over between them.
enum WebAuthBrowserStore {
    static let dataStore = WKWebsiteDataStore.default()

    static func makeConfiguration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore
        return config
    }

    /// Clears GitHub's own session cookies from the shared store so the next sign-in shows
    /// a real login form instead of silently re-authorizing the same account. Temporary,
    /// for multi-account testing (tracking issue: see GitHubAuthManager.signOut) — real
    /// end users should keep the silent-reauth convenience this store is designed for.
    static func clearGitHubSession() async {
        let matchingDomains = ["github.com", "githubusercontent.com", "accounts.google.com"]
        let records = await dataStore.dataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes())
        let toRemove = records.filter { record in
            matchingDomains.contains { record.displayName.contains($0) }
        }
        await dataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: toRemove)
    }
}
