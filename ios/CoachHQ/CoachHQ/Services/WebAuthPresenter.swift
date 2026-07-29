import Combine
import Foundation
import SwiftUI

enum WebAuthError: Error, LocalizedError {
    case cancelled

    var errorDescription: String? {
        switch self {
        case .cancelled: return "Sign-in cancelled."
        }
    }
}

/// Presents the shared in-app WKWebView for OAuth (`coachhq://` callback) or browse-only
/// setup steps. One cookie jar across sign-in, repo create, and install.
@MainActor
final class WebAuthPresenter: ObservableObject {
    static let shared = WebAuthPresenter()

    enum Mode: Equatable {
        case authenticate(callbackScheme: String)
        case browse
    }

    @Published private(set) var isPresented = false
    @Published private(set) var currentURL: URL?
    @Published private(set) var mode: Mode = .browse

    private var continuation: CheckedContinuation<URL, Error>?

    private init() {}

    /// Binding for SwiftUI `.sheet` — handles swipe-to-dismiss.
    var isPresentedBinding: Binding<Bool> {
        Binding(
            get: { self.isPresented },
            set: { if !$0 { self.handleSheetDismissed() } }
        )
    }

    func handleSheetDismissed() {
        switch mode {
        case .authenticate:
            cancel()
        case .browse:
            dismissBrowse()
        }
    }

    /// OAuth / install flow — resumes when navigation hits `coachhq://…`.
    func start(url: URL, callbackScheme: String = "coachhq") async throws -> URL {
        if let pending = continuation {
            pending.resume(throwing: WebAuthError.cancelled)
            continuation = nil
        }
        if isPresented, case .browse = mode {
            dismissBrowse()
        }

        mode = .authenticate(callbackScheme: callbackScheme)
        currentURL = url
        isPresented = true

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    /// Repo create and other GitHub pages — user dismisses manually; cookies persist for step 2.
    func presentBrowse(
        url: URL,
        onNavigation: ((URL) -> Void)? = nil,
        onDismiss: (() -> Void)? = nil
    ) {
        mode = .browse
        currentURL = url
        onBrowseNavigation = onNavigation
        onBrowseDismiss = onDismiss
        isPresented = true
    }

    /// Called from WKWebView when the athlete navigates during browse mode.
    var onBrowseNavigation: ((URL) -> Void)?
    private var onBrowseDismiss: (() -> Void)?

    func complete(with url: URL) {
        isPresented = false
        currentURL = nil
        continuation?.resume(returning: url)
        continuation = nil
    }

    func cancel() {
        isPresented = false
        currentURL = nil
        continuation?.resume(throwing: WebAuthError.cancelled)
        continuation = nil
    }

    func dismissBrowse() {
        isPresented = false
        currentURL = nil
        onBrowseNavigation = nil
        onBrowseDismiss?()
        onBrowseDismiss = nil
    }
}
