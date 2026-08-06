import Foundation

/// Client for /api/coach-chat - a thin client of the same endpoint the web app talks to
/// (see docs/eng-docs/coach-chat-flow.md, ADR 0012). No Gemini calls or Git Data API commit
/// logic here: the server does all of that. Kept separate from GitHubAPIClient, which talks
/// straight to GitHub's REST API for HealthKit sync - this hits the dashboard's own API
/// instead, same as GitHubAPIClient.fetchWidgetSnapshots() already does for Home (ADR 0005).
final class CoachChatAPIClient {
    private let authManager: GitHubAuthManager

    init(authManager: GitHubAuthManager) {
        self.authManager = authManager
    }

    /// A5: last repoSha seen per thread - mirrors coachChatModel.ts's lastKnownSha. Sent back
    /// as knownSha on the next message in that thread so the server can detect the repo
    /// changed since (e.g. a session wrapped on the web app) without any lock.
    private static var lastKnownSha: [String: String] = [:]

    private func rememberRepoSha(_ threadId: String?, _ sha: String?) {
        guard let threadId, let sha else { return }
        Self.lastKnownSha[threadId] = sha
    }

    /// Mirrors coachChatModel.ts's pruneRepoSha: drops entries for threads no longer present
    /// once a full thread-list refresh gives us the authoritative current set - without this,
    /// `lastKnownSha` only ever grows for the lifetime of the process (harmless at today's scale,
    /// a handful of small strings, but unbounded).
    private func pruneRepoSha(currentThreadIds: [String]) {
        let keep = Set(currentThreadIds)
        Self.lastKnownSha = Self.lastKnownSha.filter { keep.contains($0.key) }
    }

    private struct AuthContext {
        let token: String
        let repoFull: String
    }

    private func requireAuth() async throws -> AuthContext {
        guard let token = await authManager.validToken() else {
            throw GitHubAPIError.notAuthenticated
        }
        guard let repoFull = await authManager.repoFullName else {
            throw GitHubAPIError.sessionNotReady
        }
        return AuthContext(token: token, repoFull: repoFull)
    }

    private func request(_ method: String, path: String = "/api/coach-chat", body: [String: Any]? = nil, auth: AuthContext) throws -> URLRequest {
        guard let url = URL(string: "\(Secrets.dashboardBaseURL)\(path)") else {
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

    /// Runs `operation` up to `attempts` times with exponential backoff (0.5s, 1s, 2s…),
    /// mirroring GitHubAPIClient.withRetry. `retryNetworkFailures` should stay false for
    /// sendMessage(): a 5xx/429 response is safe to retry (the server confirmed nothing
    /// committed), but a raw network failure isn't - the commit could have landed before the
    /// response was lost, and retrying would re-run Gemini + the commit a second time.
    private func withRetry<T>(
        attempts: Int = 3,
        retryNetworkFailures: Bool = true,
        operation: () async throws -> T,
    ) async throws -> T {
        var lastError: Error = GitHubAPIError.requestFailed(operation: "Coach chat", status: nil, detail: nil)
        for attempt in 0..<attempts {
            do {
                return try await operation()
            } catch {
                guard Self.isTransient(error, retryNetworkFailures: retryNetworkFailures), attempt < attempts - 1 else {
                    throw error
                }
                lastError = error
                let delay = 0.5 * pow(2, Double(attempt))
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
        throw lastError
    }

    /// 5xx/429 always transient; a raw network-level failure only when `retryNetworkFailures`
    /// is true (see withRetry above). Otherwise mirrors GitHubAPIClient.isTransient.
    private static func isTransient(_ error: Error, retryNetworkFailures: Bool) -> Bool {
        if let apiError = error as? GitHubAPIError {
            switch apiError {
            case .requestFailed(_, let status, _), .commitFailed(_, let status, _):
                guard let status else { return retryNetworkFailures } // no status = network-level failure
                return status >= 500 || status == 429
            case .notAuthenticated, .sessionNotReady, .widgetSnapshotsPlaceholder, .decodingFailed, .notFound:
                return false
            }
        }
        if error is CancellationError { return false }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            guard retryNetworkFailures else { return false }
            return [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost,
                    NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost,
                    NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed].contains(ns.code)
        }
        return false
    }

    private func send(_ req: URLRequest, operation: String, retryNetworkFailures: Bool = true) async throws -> Data {
        try await withRetry(retryNetworkFailures: retryNetworkFailures) {
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

    /// A3: warm the server's context read-through cache (SOUL.md/state.md/quest_log.md, 60s
    /// TTL - ui/api/_lib/coachChatFiles.ts) as soon as the app becomes active, so the eventual
    /// greeting turn / first message doesn't pay a fresh GitHub round-trip on top of the Gemini
    /// call. Best-effort - a failure here just means the real turn pays full latency, same as
    /// before this existed, so callers should fire-and-forget rather than surface errors.
    func prefetchContext() async {
        guard let auth = try? await requireAuth(), let req = try? request("GET", path: "/api/coach-chat-context", auth: auth) else {
            return
        }
        _ = try? await send(req, operation: "Warming coach chat context")
    }

    /// A4: coach speaks first. Call on landing on "new conversation" - no athlete message yet.
    /// Server either reuses today's still-unanswered greeting thread or creates + commits a
    /// new one with just Coach's opening line (mirrors coachChatModel.ts's greet()).
    ///
    /// B4: pass `onboardingHints` (from OnboardingHints.load()) on a brand-new athlete's very
    /// first greet - the server folds them into the greeting turn's prompt so the First Session
    /// Protocol can reflect the athlete's native sport/goal picks back instead of asking cold.
    /// Only meaningful the server-side reuse path doesn't apply to, i.e. genuinely creating a
    /// new thread - harmless to pass on a reuse hit too, the server just ignores it there.
    func greet(onboardingHints: (sports: [String], goal: String)? = nil) async throws -> ChatGreetResponse {
        let auth = try await requireAuth()
        var body: [String: Any] = ["action": "greet"]
        if let onboardingHints {
            body["onboardingHints"] = ["sports": onboardingHints.sports, "goal": onboardingHints.goal]
        }
        let req = try request("POST", body: body, auth: auth)
        let data = try await send(req, operation: "Starting conversation", retryNetworkFailures: false)
        let decoded = try JSONDecoder().decode(ChatGreetResponse.self, from: data)
        rememberRepoSha(decoded.threadId, decoded.repoSha)
        pruneRepoSha(currentThreadIds: decoded.threads.map(\.id))
        return decoded
    }

    /// B2/B3: has this athlete finished the First Session Protocol? Backs
    /// CoachSetupBootstrap.shouldOpenChatFirst() - a live server check instead of the old
    /// thread-existence heuristic, since a thread existing has never meant the intake actually
    /// finished.
    func profileStatus() async throws -> Bool {
        let auth = try await requireAuth()
        let req = try request("GET", path: "/api/coach-chat-profile-status", auth: auth)
        let data = try await send(req, operation: "Checking profile status")
        return try JSONDecoder().decode(ChatProfileStatusResponse.self, from: data).profileComplete
    }

    func fetchThreads() async throws -> [ChatThread] {
        let auth = try await requireAuth()
        let req = try request("GET", auth: auth)
        let data = try await send(req, operation: "Loading conversations")
        let threads = try JSONDecoder().decode(ChatThreadsResponse.self, from: data).threads
        pruneRepoSha(currentThreadIds: threads.map(\.id))
        return threads
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
        if let threadId {
            body["threadId"] = threadId
            if let knownSha = Self.lastKnownSha[threadId] { body["knownSha"] = knownSha }
        }
        let req = try request("POST", body: body, auth: auth)
        let data = try await send(req, operation: "Sending message", retryNetworkFailures: false)
        let decoded = try JSONDecoder().decode(ChatSendResponse.self, from: data)
        rememberRepoSha(decoded.closed ? decoded.threadId : threadId, decoded.repoSha)
        if let threads = decoded.threads { pruneRepoSha(currentThreadIds: threads.map(\.id)) }
        return decoded
    }

    func setThreadStatus(threadId: String, status: ChatThreadStatus) async throws -> [ChatThread] {
        let auth = try await requireAuth()
        let req = try request("PATCH", body: ["threadId": threadId, "status": status.rawValue], auth: auth)
        let data = try await send(req, operation: "Updating conversation")
        let threads = try JSONDecoder().decode(ChatThreadsResponse.self, from: data).threads
        pruneRepoSha(currentThreadIds: threads.map(\.id))
        return threads
    }
}
