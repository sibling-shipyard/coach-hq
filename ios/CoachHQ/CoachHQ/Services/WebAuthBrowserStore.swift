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
}
