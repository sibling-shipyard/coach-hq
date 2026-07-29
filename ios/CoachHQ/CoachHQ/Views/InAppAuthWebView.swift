import SwiftUI
import WebKit

/// In-app browser backed by `WebAuthBrowserStore` — same cookies for OAuth, repo create, install.
struct InAppAuthWebView: View {
    let url: URL
    let mode: WebAuthPresenter.Mode
    var onCallback: ((URL) -> Void)?
    var onCancel: (() -> Void)?
    var onDismissBrowse: (() -> Void)?

    var body: some View {
        NavigationStack {
            InAppAuthWebViewRepresentable(
                url: url,
                mode: mode,
                onCallback: onCallback,
                onCancel: onCancel
            )
            .ignoresSafeArea(edges: .bottom)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        switch mode {
                        case .authenticate:
                            onCancel?()
                        case .browse:
                            onDismissBrowse?()
                        }
                    }
                }
            }
        }
    }
}

private struct InAppAuthWebViewRepresentable: UIViewRepresentable {
    let url: URL
    let mode: WebAuthPresenter.Mode
    var onCallback: ((URL) -> Void)?
    var onCancel: (() -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(mode: mode, onCallback: onCallback, onCancel: onCancel)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero, configuration: WebAuthBrowserStore.makeConfiguration())
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let mode: WebAuthPresenter.Mode
        var onCallback: ((URL) -> Void)?
        var onCancel: (() -> Void)?

        init(mode: WebAuthPresenter.Mode, onCallback: ((URL) -> Void)?, onCancel: (() -> Void)?) {
            self.mode = mode
            self.onCallback = onCallback
            self.onCancel = onCancel
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            if let url = navigationAction.request.url {
                if case .browse = mode {
                    WebAuthPresenter.shared.onBrowseNavigation?(url)
                }
                if case .authenticate(let callbackScheme) = mode,
                   url.scheme?.lowercased() == callbackScheme.lowercased() {
                    decisionHandler(.cancel)
                    onCallback?(url)
                    return
                }
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard case .browse = mode, let url = webView.url else { return }
            WebAuthPresenter.shared.onBrowseNavigation?(url)
        }

        /// Google / GitHub federated login opens target=_blank — load in the same web view.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }
    }
}
