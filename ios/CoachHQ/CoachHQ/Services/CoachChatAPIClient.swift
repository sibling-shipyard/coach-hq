import Foundation

/// Client for /api/coach-chat - a thin client of the same endpoint the web app talks to
/// (see engine/docs/coach-chat-flow.md, ADR 0012). No Gemini calls or Git Data API commit
/// logic here: the server does all of that. Kept separate from GitHubAPIClient, which talks
/// straight to GitHub's REST API for HealthKit sync - this hits the dashboard's own API
/// instead, same as GitHubAPIClient.fetchWidgetSnapshots() already does for Home (ADR 0005).
final class CoachChatAPIClient {
    private let authManager: GitHubAuthManager

    init(authManager: GitHubAuthManager) {
        self.authManager = authManager
    }

    private struct AuthContext {
        let token: String
        let repoFull: String
    }

    private func requireAuth() async throws -> AuthContext {
        guard let token = await authManager.validToken() else {
            throw GitHubAPIError.notAuthenticated
        }
        guard let user = authManager.user?.login, let repo = authManager.selectedRepo else {
            throw GitHubAPIError.sessionNotReady
        }
        return AuthContext(token: token, repoFull: "\(user)/\(repo)")
    }

    private func request(_ method: String, body: [String: Any]? = nil, auth: AuthContext) throws -> URLRequest {
        guard let url = URL(string: "\(Secrets.dashboardBaseURL)/api/coach-chat") else {
            throw GitHubAPIError.decodingFailed(operation: "Coach chat URL")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(auth.token)", forHTTPHeaderField: "Authorization")
        req.setValue(auth.repoFull, forHTTPHeaderField: "X-Coach-Repo")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return req
    }

    /// Runs `operation` up to `attempts` times with exponential backoff (0.5s, 1s, 2s…) -
    /// mirrors GitHubAPIClient.withRetry so this client is as resilient to a network blip as
    /// every other network-touching service in the app, instead of failing outright on the
    /// first drop.
    private func withRetry<T>(attempts: Int = 3, operation: () async throws -> T) async throws -> T {
        var lastError: Error = GitHubAPIError.requestFailed(operation: "Coach chat", status: nil, detail: nil)
        for attempt in 0..<attempts {
            do {
                return try await operation()
            } catch {
                lastError = error
                guard Self.isTransient(error), attempt < attempts - 1 else { throw error }
                let delay = 0.5 * pow(2, Double(attempt))
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
        throw lastError
    }

    /// Transient = worth retrying: network drops, timeouts, 5xx, 429 - never a 4xx rejection
    /// (400/401/etc are real answers, not blips to paper over). Mirrors
    /// GitHubAPIClient.isTransient's classification.
    private static func isTransient(_ error: Error) -> Bool {
        if let apiError = error as? GitHubAPIError {
            switch apiError {
            case .requestFailed(_, let status, _), .commitFailed(_, let status, _):
                guard let status else { return true } // no status = network-level failure
                return status >= 500 || status == 429
            case .notAuthenticated, .sessionNotReady, .widgetSnapshotsPlaceholder, .decodingFailed, .notFound:
                return false
            }
        }
        if error is CancellationError { return false }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            return [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost,
                    NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost,
                    NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed].contains(ns.code)
        }
        return false
    }

    private func send(_ req: URLRequest, operation: String) async throws -> Data {
        try await withRetry {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                throw GitHubAPIError.decodingFailed(operation: operation)
            }
            if http.statusCode == 401 {
                throw GitHubAPIError.notAuthenticated
            }
            if !(200...299).contains(http.statusCode) {
                let detail = (try? JSONDecoder().decode(ChatAPIErrorBody.self, from: data))?.error
                    ?? String(data: data, encoding: .utf8)
                throw GitHubAPIError.requestFailed(operation: operation, status: http.statusCode, detail: detail)
            }
            return data
        }
    }

    func fetchThreads() async throws -> [ChatThread] {
        let auth = try await requireAuth()
        let req = try request("GET", auth: auth)
        let data = try await send(req, operation: "Loading conversations")
        return try JSONDecoder().decode(ChatThreadsResponse.self, from: data).threads
    }

    /// Mirrors coachChatModel.ts's sendMessage(): the client owns the running thread history
    /// until a `closed: true` response reports a real commit happened (coach-chat-flow.md).
    func sendMessage(threadId: String?, priorMessages: [ChatMessage], message: String) async throws -> ChatSendResponse {
        let auth = try await requireAuth()
        let messagesJSON = try priorMessages.map { msg -> [String: Any] in
            let data = try JSONEncoder().encode(msg)
            return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        }
        var body: [String: Any] = ["messages": messagesJSON, "message": message]
        if let threadId { body["threadId"] = threadId }
        let req = try request("POST", body: body, auth: auth)
        let data = try await send(req, operation: "Sending message")
        return try JSONDecoder().decode(ChatSendResponse.self, from: data)
    }

    func setThreadStatus(threadId: String, status: ChatThreadStatus) async throws -> [ChatThread] {
        let auth = try await requireAuth()
        let req = try request("PATCH", body: ["threadId": threadId, "status": status.rawValue], auth: auth)
        let data = try await send(req, operation: "Updating conversation")
        return try JSONDecoder().decode(ChatThreadsResponse.self, from: data).threads
    }
}
