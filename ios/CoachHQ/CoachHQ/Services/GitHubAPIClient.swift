import Foundation

/// Client for reading and writing files to the user's GitHub repository via the Contents API.
///
/// Smooth-UX round additions:
/// - **Automatic retries** with exponential backoff on transient failures
///   (network errors, 5xx, 409 ref conflicts) — users were manually retrying
///   2-3 times to get saves through; the client now does that itself.
/// - **Readable errors** — `GitHubAPIError` carries the failing operation,
///   HTTP status, and GitHub's own error message, so failures say
///   "Saving scores failed: GitHub returned 409 (…)" instead of a generic
///   "The operation couldn't be completed".
/// - **ETag conditional requests** — reads send `If-None-Match` and reuse the
///   cached body on `304 Not Modified`. Fresh like a no-cache read (GitHub
///   revalidates against the current ref), but unchanged files cost only a
///   tiny header exchange — fast on cellular, and immune to the stale
///   max-age=60 cache problem fixed earlier.
class GitHubAPIClient {
    private let authManager: GitHubAuthManager
    var targetBranch: String {
        TestModeManager.shared.targetBranch
    }

    init(authManager: GitHubAuthManager) {
        self.authManager = authManager
    }

    private var baseURL: String {
        get throws {
            guard authManager.loadToken() != nil else {
                throw GitHubAPIError.notAuthenticated
            }
            guard let user = authManager.user?.login,
                  let repo = authManager.selectedRepo else {
                throw GitHubAPIError.sessionNotReady
            }
            return "https://api.github.com/repos/\(user)/\(repo)"
        }
    }

    private var headers: [String: String] {
        guard let token = authManager.loadToken() else { return [:] }
        return [
            "Authorization": "Bearer \(token)",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json"
        ]
    }

    // MARK: - Retry core

    /// Runs `operation` up to `attempts` times with exponential backoff
    /// (0.5s, 1s, 2s…). Only transient errors are retried; permanent ones
    /// (auth, 404, decoding) surface immediately.
    private func withRetry<T>(
        _ label: String,
        attempts: Int = 3,
        operation: () async throws -> T
    ) async throws -> T {
        var lastError: Error = GitHubAPIError.requestFailed(operation: label, status: nil, detail: nil)
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

    /// Transient = worth retrying: network drops, timeouts, 5xx, 409 conflicts,
    /// 403 secondary rate limits. Permanent: auth, 404, 422, decoding.
    private static func isTransient(_ error: Error) -> Bool {
        if let apiError = error as? GitHubAPIError {
            switch apiError {
            case .requestFailed(_, let status, _), .commitFailed(_, let status, _):
                guard let status else { return true }   // no status = network-level failure
                return status >= 500 || status == 409 || status == 429 || status == 403
            case .notAuthenticated, .sessionNotReady, .widgetSnapshotsPlaceholder, .decodingFailed, .notFound:
                return false
            }
        }
        if error is CancellationError { return false }   // cancelled ≠ transient
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            // NSURLErrorCancelled deliberately excluded — retrying a cancelled
            // request just delays teardown.
            return [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost,
                    NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost,
                    NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed].contains(ns.code)
        }
        return false
    }

    /// Extracts GitHub's own `message` field from an error response body.
    private static func gitHubMessage(from data: Data?) -> String? {
        guard let data,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = obj["message"] as? String else { return nil }
        return message
    }

    // MARK: - ETag cache

    /// In-memory ETag + body cache, keyed by URL. GitHub revalidates ETags
    /// against the live ref, so a 304 is as fresh as a full fetch.
    private static let etagCache = ETagCache()

    /// Performs a GET with `If-None-Match` revalidation. Returns the response
    /// body — either fresh (200, cached for next time) or revalidated (304).
    private func conditionalGET(_ urlString: String, label: String) async throws -> Data {
        guard let url = URL(string: urlString) else {
            throw GitHubAPIError.requestFailed(operation: label, status: nil, detail: "Bad URL")
        }
        // Bypass URLSession's own HTTP cache entirely — we manage freshness
        // via ETags. (URLSession's default policy honored GitHub's
        // max-age=60 and served pre-commit content after saves.)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
        if let cached = await Self.etagCache.entry(for: urlString) {
            request.setValue(cached.etag, forHTTPHeaderField: "If-None-Match")
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GitHubAPIError.requestFailed(operation: label, status: nil, detail: "No HTTP response")
        }

        switch http.statusCode {
        case 200:
            if let etag = http.value(forHTTPHeaderField: "ETag") {
                await Self.etagCache.store(etag: etag, body: data, for: urlString)
            }
            return data
        case 304:
            if let cached = await Self.etagCache.entry(for: urlString) {
                return cached.body
            }
            // 304 without a cached body shouldn't happen; refetch without ETag.
            await Self.etagCache.remove(for: urlString)
            return try await conditionalGET(urlString, label: label)
        case 404:
            throw GitHubAPIError.notFound(operation: label)
        default:
            throw GitHubAPIError.requestFailed(
                operation: label,
                status: http.statusCode,
                detail: Self.gitHubMessage(from: data)
            )
        }
    }

    // MARK: - Read Operations

    /// Lists files in a directory (e.g., "user_data/activities/hist")
    func listFiles(path: String) async throws -> [GitHubFileEntry] {
        let label = "Listing \(path)"
        return try await withRetry(label) {
            let data = try await conditionalGET(
                "\(try baseURL)/contents/\(path)?ref=\(targetBranch)", label: label)
            do {
                return try JSONDecoder().decode([GitHubFileEntry].self, from: data)
            } catch {
                throw GitHubAPIError.decodingFailed(operation: label)
            }
        }
    }

    /// Reads a single file's content (decoded from base64)
    func readFile(path: String) async throws -> Data {
        let label = "Reading \(path)"
        return try await withRetry(label) {
            let data = try await conditionalGET(
                "\(try baseURL)/contents/\(path)?ref=\(targetBranch)", label: label)
            let fileResponse: GitHubFileContent
            do {
                fileResponse = try JSONDecoder().decode(GitHubFileContent.self, from: data)
            } catch {
                throw GitHubAPIError.decodingFailed(operation: label)
            }
            guard let content = fileResponse.content,
                  let decoded = Data(base64Encoded: content.replacingOccurrences(of: "\n", with: "")) else {
                throw GitHubAPIError.decodingFailed(operation: label)
            }
            return decoded
        }
    }

    func readSyncState() async throws -> SyncState {
        let data = try await readFile(path: "user_data/activities/sync_state.json")
        do {
            return try JSONDecoder().decode(SyncState.self, from: data)
        } catch {
            throw GitHubAPIError.decodingFailed(operation: "Parsing sync state")
        }
    }

    /// Reads a single activity from `user_data/activities/hist/<fileName>`.
    func readActivity(fileName: String) async throws -> Activity {
        let data = try await readFile(path: "user_data/activities/hist/\(fileName)")
        do {
            return try JSONDecoder().decode(Activity.self, from: data)
        } catch {
            throw GitHubAPIError.decodingFailed(operation: "Parsing \(fileName)")
        }
    }

    /// Reads the full badminton match history from `training/ebadders_history.json`.
    func readEbaddersHistory() async throws -> [EbaddersEntry] {
        let data = try await readFile(path: "training/ebadders_history.json")
        do {
            return try JSONDecoder().decode([EbaddersEntry].self, from: data)
        } catch {
            throw GitHubAPIError.decodingFailed(operation: "Parsing match history")
        }
    }

    /// Fetches live Warm Instrument snapshots from the hosted dashboard API (ADR 0005).
    /// HQ runs the TS generator server-side from `gen/aggregate.json` — athlete repos
    /// do not need a committed `gen/widget_snapshots.json`.
    func fetchWidgetSnapshots() async throws -> WidgetSnapshotsFile {
        guard let token = authManager.loadToken() else {
            throw GitHubAPIError.notAuthenticated
        }
        guard let user = authManager.user?.login,
              let repo = authManager.selectedRepo else {
            throw GitHubAPIError.sessionNotReady
        }

        let repoFull = "\(user)/\(repo)"
        guard let url = URL(string: "\(Secrets.dashboardBaseURL)/api/widget-snapshots") else {
            throw GitHubAPIError.decodingFailed(operation: "Widget snapshots URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(repoFull, forHTTPHeaderField: "X-Coach-Repo")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GitHubAPIError.decodingFailed(operation: "Widget snapshots")
        }

        if http.statusCode == 401 {
            throw GitHubAPIError.notAuthenticated
        }

        if !(200...299).contains(http.statusCode) {
            let detail = String(data: data, encoding: .utf8)
            throw GitHubAPIError.requestFailed(
                operation: "Loading Home snapshots",
                status: http.statusCode,
                detail: detail
            )
        }

        do {
            return try JSONDecoder().decode(WidgetSnapshotsFile.self, from: data)
        } catch {
            let detail = WidgetSnapshotsFile.decodingErrorDescription(error)
            throw GitHubAPIError.decodingFailed(operation: "Parsing widget snapshots (\(detail))")
        }
    }

    /// Reads the Warm Instrument Home widget snapshots from `gen/widget_snapshots.json`
    /// (legacy repos may still have `training/widget_snapshots.json`) — generated on every
    /// sync/build from the same TS models as the web home dashboard (see ADR 0005).
    func readWidgetSnapshots() async throws -> WidgetSnapshotsFile {
        let paths = [
            "gen/widget_snapshots.json",
            "training/widget_snapshots.json",
        ]
        var lastDecodeError: Error?
        var sawFile = false

        for path in paths {
            let data: Data
            do {
                data = try await readFile(path: path)
                sawFile = true
            } catch let error as GitHubAPIError {
                if case .notFound = error { continue }
                throw error
            }

            do {
                try Self.validateWidgetSnapshotPayload(data)
                return try JSONDecoder().decode(WidgetSnapshotsFile.self, from: data)
            } catch let error as GitHubAPIError {
                throw error
            } catch {
                lastDecodeError = error
            }
        }

        if let lastDecodeError {
            if Self.isPlaceholderPayloadError(lastDecodeError) {
                throw GitHubAPIError.widgetSnapshotsPlaceholder
            }
            let detail = WidgetSnapshotsFile.decodingErrorDescription(lastDecodeError)
            throw GitHubAPIError.decodingFailed(operation: "Parsing widget snapshots (\(detail))")
        }
        if sawFile {
            throw GitHubAPIError.decodingFailed(operation: "Parsing widget snapshots")
        }
        throw GitHubAPIError.notFound(operation: "Reading widget snapshots")
    }

    /// Skeleton repos ship `"home": {}` until the data pipeline runs. Fail fast with a
    /// actionable message instead of a cryptic Codable key-not-found.
    private static func validateWidgetSnapshotPayload(_ data: Data) throws {
        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let home = json["home"] as? [String: Any]
        else { return }

        if home.isEmpty || home["engine"] == nil {
            throw GitHubAPIError.widgetSnapshotsPlaceholder
        }
    }

    private static func isPlaceholderPayloadError(_ error: Error) -> Bool {
        guard case DecodingError.keyNotFound(let key, let context) = error else { return false }
        return key.stringValue == "engine" && context.codingPath.map(\.stringValue) == ["home"]
    }

    func writeSyncState(_ state: SyncState) async throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(state)
        try await commitFile(
            path: "user_data/activities/sync_state.json",
            content: data,
            message: "sync: update hk sync state"
        )
    }

    // MARK: - Write Operations

    /// Commits multiple files in a single Git commit using the Git Data API.
    ///
    /// The whole tree/commit/ref sequence runs inside `withRetry`: a
    /// non-fast-forward ref update (branch moved since reading HEAD — another
    /// sync landed, or "Reset Test Branch" recreated the branch mid-save)
    /// throws a transient 409-class error, and the retry rebuilds everything
    /// against a fresh HEAD. Blobs don't depend on HEAD, so they're created
    /// once and reused across attempts.
    func commitFiles(_ files: [(path: String, data: Data)], message: String) async throws {
        let base = try baseURL

        // Create blobs once — independent of HEAD, safe to reuse across retries.
        // (Sequential, not a task group, to avoid Swift 6 actor-isolation issues.)
        var blobs: [(path: String, sha: String)] = []
        for file in files {
            let data = try await withRetry("Uploading \(file.path)") {
                try await post("\(base)/git/blobs", body: [
                    "content": file.data.base64EncodedString(),
                    "encoding": "base64"
                ], label: "Uploading \(file.path)")
            }
            let sha = try JSONDecoder().decode(GitBlob.self, from: data).sha
            blobs.append((file.path, sha))
        }

        try await withRetry("Committing changes", attempts: 3) {
            // 1. Get current HEAD SHA (fresh each attempt)
            let refData = try await get("\(base)/git/ref/heads/\(targetBranch)", label: "Reading branch \(targetBranch)")
            let headSHA = try JSONDecoder().decode(GitRef.self, from: refData).object.sha

            // 2. Get tree SHA from HEAD commit
            let commitData = try await get("\(base)/git/commits/\(headSHA)", label: "Reading HEAD commit")
            let treeSHA = try JSONDecoder().decode(GitCommitResponse.self, from: commitData).tree.sha

            // 3. Create tree
            let treeData = try await post("\(base)/git/trees", body: [
                "base_tree": treeSHA,
                "tree": blobs.map { ["path": $0.path, "mode": "100644", "type": "blob", "sha": $0.sha] }
            ], label: "Building commit tree")
            let newTreeSHA = try JSONDecoder().decode(GitTree.self, from: treeData).sha

            // 4. Create commit
            let newCommitData = try await post("\(base)/git/commits", body: [
                "message": message,
                "tree": newTreeSHA,
                "parents": [headSHA]
            ], label: "Creating commit")
            let newCommitSHA = try JSONDecoder().decode(GitCommitResponse.self, from: newCommitData).sha

            // 5. Update ref — non-fast-forward (branch moved since step 1) fails
            //    here with 409/422; classified transient so withRetry rebuilds.
            var updateReq = URLRequest(url: URL(string: "\(base)/git/refs/heads/\(targetBranch)")!,
                                       cachePolicy: .reloadIgnoringLocalCacheData)
            updateReq.httpMethod = "PATCH"
            headers.forEach { updateReq.setValue($1, forHTTPHeaderField: $0) }
            updateReq.httpBody = try JSONSerialization.data(withJSONObject: ["sha": newCommitSHA])
            let (respData, updateResp) = try await URLSession.shared.data(for: updateReq)
            guard let http = updateResp as? HTTPURLResponse, http.statusCode == 200 else {
                let status = (updateResp as? HTTPURLResponse)?.statusCode
                // Treat ref-update failures as transient (branch likely moved).
                throw GitHubAPIError.commitFailed(
                    operation: "Updating branch \(targetBranch)",
                    status: status == 422 ? 409 : status,   // 422 non-FF ⇒ retryable
                    detail: Self.gitHubMessage(from: respData)
                )
            }
        }
    }

    private func get(_ urlString: String, label: String) async throws -> Data {
        // Fresh reads only — stale ref/commit SHAs here would break commitFiles.
        var req = URLRequest(url: URL(string: urlString)!, cachePolicy: .reloadIgnoringLocalCacheData)
        headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode
            throw GitHubAPIError.requestFailed(operation: label, status: status,
                                               detail: Self.gitHubMessage(from: data))
        }
        return data
    }

    private func post(_ urlString: String, body: [String: Any], label: String) async throws -> Data {
        var req = URLRequest(url: URL(string: urlString)!, cachePolicy: .reloadIgnoringLocalCacheData)
        req.httpMethod = "POST"
        headers.forEach { req.setValue($1, forHTTPHeaderField: $0) }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200...201).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode
            throw GitHubAPIError.requestFailed(operation: label, status: status,
                                               detail: Self.gitHubMessage(from: data))
        }
        return data
    }

    /// Commits a new file or updates an existing file in the repository
    func commitFile(path: String, content: Data, message: String) async throws {
        let label = "Saving \(path)"
        try await withRetry(label) {
            let url = URL(string: "\(try baseURL)/contents/\(path)")!
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
            request.httpMethod = "PUT"
            headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }

            // Check if file exists (need SHA for updates) — fresh read each
            // attempt, so a 409 from a stale SHA heals itself on retry.
            let sha = try? await getFileSHA(path: path)

            var body: [String: Any] = [
                "message": message,
                "content": content.base64EncodedString(),
                "branch": targetBranch
            ]
            if let sha = sha {
                body["sha"] = sha
            }

            request.httpBody = try JSONSerialization.data(withJSONObject: body)

            let (respData, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...201).contains(httpResponse.statusCode) else {
                let status = (response as? HTTPURLResponse)?.statusCode
                throw GitHubAPIError.commitFailed(operation: label, status: status,
                                                  detail: Self.gitHubMessage(from: respData))
            }
        }
    }

    /// Gets the SHA of an existing file (needed for updates)
    private func getFileSHA(path: String) async throws -> String {
        let label = "Checking \(path)"
        let url = URL(string: "\(try baseURL)/contents/\(path)?ref=\(targetBranch)")!
        // Fresh reads only — a stale SHA here would make commitFile 409.
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode
            throw GitHubAPIError.requestFailed(operation: label, status: status,
                                               detail: Self.gitHubMessage(from: data))
        }

        let fileResponse = try JSONDecoder().decode(GitHubFileContent.self, from: data)
        guard let sha = fileResponse.sha else {
            throw GitHubAPIError.decodingFailed(operation: label)
        }
        return sha
    }
}

// MARK: - ETag cache actor

/// Thread-safe in-memory ETag store. Capped to avoid unbounded growth;
/// entries are tiny (one activity JSON each), so 200 is plenty for a
/// 7-day feed plus history reads.
private actor ETagCache {
    struct Entry {
        let etag: String
        let body: Data
    }

    private var storage: [String: Entry] = [:]
    private var order: [String] = []
    private let maxEntries = 200

    func entry(for key: String) -> Entry? { storage[key] }

    func store(etag: String, body: Data, for key: String) {
        if storage[key] == nil {
            order.append(key)
            if order.count > maxEntries {
                let evicted = order.removeFirst()
                storage[evicted] = nil
            }
        }
        storage[key] = Entry(etag: etag, body: body)
    }

    func remove(for key: String) {
        storage[key] = nil
        order.removeAll { $0 == key }
    }
}

// MARK: - Supporting Types

struct SyncState: Codable {
    var oldestSynced: String?
    var newestSynced: String?
    var totalActivities: Int?
    var since: String?
    var lastRun: String?
    var counters: [String: Int]?
    var hkLastSynced: String?

    enum CodingKeys: String, CodingKey {
        case oldestSynced = "oldest_synced"
        case newestSynced = "newest_synced"
        case totalActivities = "total_activities"
        case since
        case lastRun = "last_run"
        case counters
        case hkLastSynced = "hk_last_synced"
    }
}

struct GitHubFileEntry: Codable {
    let name: String
    let path: String
    let type: String // "file" or "dir"
    let sha: String
}

struct GitHubFileContent: Codable {
    let content: String?
    let sha: String?
    let encoding: String?
}

private struct GitRef: Decodable, Sendable {
    struct Object: Decodable, Sendable { let sha: String }
    let object: Object
}

private struct GitCommitResponse: Decodable, Sendable {
    struct Tree: Decodable, Sendable { let sha: String }
    let sha: String
    let tree: Tree
}

private struct GitBlob: Decodable, Sendable { let sha: String }
private struct GitTree: Decodable, Sendable { let sha: String }

/// Errors that explain themselves: which operation failed, the HTTP status,
/// and GitHub's own message when available. Retries happen automatically for
/// transient cases before one of these ever reaches the UI.
enum GitHubAPIError: LocalizedError {
    case requestFailed(operation: String, status: Int?, detail: String?)
    case commitFailed(operation: String, status: Int?, detail: String?)
    case decodingFailed(operation: String)
    case notFound(operation: String)
    case notAuthenticated
    /// Token exists but profile/repo discovery has not finished yet — retry, don't toast.
    case sessionNotReady
    /// `gen/widget_snapshots.json` is still the carved skeleton (`home: {}`).
    case widgetSnapshotsPlaceholder

    var errorDescription: String? {
        switch self {
        case .requestFailed(let op, let status, let detail),
             .commitFailed(let op, let status, let detail):
            var parts = ["\(op) failed"]
            if let status {
                parts.append("(HTTP \(status)\(Self.hint(for: status)))")
            } else {
                parts.append("(network error — check your connection)")
            }
            if let detail, !detail.isEmpty {
                parts.append("— GitHub says: \"\(detail)\"")
            }
            return parts.joined(separator: " ")
        case .decodingFailed(let op):
            return "\(op) failed — unexpected response format from GitHub"
        case .notFound(let op):
            return "\(op) failed — file not found on GitHub (404)"
        case .notAuthenticated:
            return "Not signed in to GitHub — go to Settings and reconnect"
        case .sessionNotReady:
            return nil
        case .widgetSnapshotsPlaceholder:
            return "Home data isn't ready yet — sync your activities, then pull to refresh."
        }
    }

    private static func hint(for status: Int) -> String {
        switch status {
        case 401: return " — token expired, reconnect in Settings"
        case 403: return " — rate limited, retried automatically"
        case 409: return " — repo changed mid-save, retried automatically"
        case 422: return " — GitHub rejected the request"
        case 500...599: return " — GitHub server issue, retried automatically"
        default: return ""
        }
    }
}
