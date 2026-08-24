import Foundation

/// Maps thrown errors to athlete-friendly copy. Raw NSError strings only when Dev Mode is on.
enum UserFacingError {
    static let devModeKey = "devModeEnabled"

    static func message(for error: Error, devMode: Bool) -> String {
        let friendly = friendlyMessage(for: error)
        guard devMode else { return friendly }
        let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        return "\(friendly)\n\n(\(detail))"
    }

    static func friendlyMessage(for error: Error) -> String {
        if error is WebAuthError {
            return "Sign-in cancelled."
        }
        if let auth = error as? AuthError {
            return auth.errorDescription ?? "Sign-in didn't work. Try again."
        }

        // Translate GitHubAPIError cases to human-readable copy.
        if let apiError = error as? GitHubAPIError {
            switch apiError {
            case .sessionNotReady:
                return "Still loading — try again in a moment."
            case .notAuthenticated:
                return "Your session expired — sign in again in Settings."
            case .widgetSnapshotsPlaceholder:
                return "Your dashboard fills in after your first chat with Coach."
            case .requestFailed(_, let status?, _), .commitFailed(_, let status?, _):
                switch status {
                case 401: return "Your session expired — sign in again in Settings."
                case 403: return "GitHub rate-limited the request — try again shortly."
                case 404: return "Nothing to show yet — complete setup or your first Coach chat."
                case 409: return "A conflict occurred — try again."
                case 422: return "GitHub rejected the request — contact support if this persists."
                // Shared by every API client through this one switch (GitHubAPIClient.swift:76
                // treats 429 as transient too, alongside coach-chat's own Gemini 429) - keep this
                // generic rather than naming a specific source. Previously fell into the generic
                // default case below, which gave no indication this was a rate limit at all or
                // that an immediate retry wouldn't help.
                case 429: return "Getting rate-limited right now — wait a moment and try again."
                case 500...599: return "Something went wrong on our end — try again shortly."
                default: return "Something went wrong. Try again."
                }
            case .requestFailed(_, nil, _), .commitFailed(_, nil, _):
                return "Couldn't reach the network — check your connection."
            case .decodingFailed:
                return "Something went wrong loading your data — pull down to refresh."
            case .notFound:
                return "Nothing to show yet — complete setup or your first Coach chat."
            }
        }

        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            return "Couldn't reach the network just now — check your connection and try again."
        }

        return "Something went wrong. Try again."
    }

    /// Home / API errors surfaced as strings (from `WidgetSnapshotStore.lastError`).
    static func friendlyAPIError(_ raw: String) -> String {
        if raw.contains("coach intake") {
            return "Your dashboard fills in after your first chat with Coach — open the Chat tab to get started."
        }
        if raw.contains("HTTP 401") || raw.contains("Not authenticated") || raw.contains("Not signed in to GitHub") {
            return "Your session expired — sign in again."
        }
        if raw.contains("HTTP 404") {
            return "Nothing to show yet — complete setup or your first Coach chat first."
        }
        if raw.contains("Invalid X-Coach-Repo") {
            return "Couldn't find your coach repo — try signing out and back in."
        }
        if raw.contains("network error") || raw.contains("check your connection") {
            return "Couldn't reach the network — check your connection and try again."
        }
        if raw.contains("unexpected response format") {
            return "Something went wrong loading your data — pull down to refresh."
        }
        if raw.contains(" failed") || raw.contains("Failed") {
            return "Something went wrong — pull down to refresh."
        }
        return raw
    }
}
