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

        let ns = error as NSError
        if ns.domain == "com.apple.AuthenticationServices.WebAuthenticationSession" {
            if ns.code == 1 { return "Sign-in cancelled." }
            return "Couldn't complete sign-in. Try again."
        }

        if ns.domain == NSURLErrorDomain {
            return "Couldn't reach the network just now — check your connection and try again."
        }

        return "Something went wrong. Try again."
    }

    /// Home / API errors that already carry a user-facing payload.
    static func friendlyAPIError(_ raw: String) -> String {
        if raw.contains("coach intake") || raw.contains("challenge_v2") {
            return "Your dashboard fills in after your first chat with Coach — open the Chat tab to get started."
        }
        if raw.contains("HTTP 401") || raw.contains("Not authenticated") {
            return "Your session expired — sign in again."
        }
        if raw.contains("HTTP 404") {
            return "Nothing to show yet — complete setup or your first Coach chat first."
        }
        if raw.contains("Invalid X-Coach-Repo") {
            return "Couldn't find your coach repo — try signing out and back in."
        }
        return raw
    }
}
