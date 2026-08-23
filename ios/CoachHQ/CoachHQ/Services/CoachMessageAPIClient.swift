import Foundation

struct CoachMessageRecord: Codable, Equatable {
    let id: String
    let createdAt: String
    let activityIds: [String]
    let body: String
    let conversationSeedId: String

    enum CodingKeys: String, CodingKey {
        case id
        case createdAt = "created_at"
        case activityIds = "activity_ids"
        case body
        case conversationSeedId = "conversation_seed_id"
    }
}

struct CoachMessageAPIResponse: Decodable, Equatable {
    let message: CoachMessageRecord
    let delivered: Bool
    let idempotent: Bool
    let shouldNotify: Bool
    let repoSha: String?

    enum CodingKeys: String, CodingKey {
        case message
        case delivered
        case idempotent
        case shouldNotify = "should_notify"
        case repoSha
    }
}

protocol CoachMessageGenerating {
    func generate(
        for activityIds: [String],
        repoFullName: String
    ) async throws -> CoachMessageAPIResponse
}

/// Authenticated client for the post-sync Coach-message endpoint.
///
/// The request contains only canonical source-qualified activity ids. Response validation is
/// deliberately stricter than Codable so malformed server data can never schedule a notification
/// or seed a local conversation.
final class CoachMessageAPIClient: CoachMessageGenerating {
    static let maximumActivityIds = 20
    static let maximumPayloadBytes = 16_384

    private let authManager: GitHubAuthManager
    private let session: URLSession

    init(authManager: GitHubAuthManager, session: URLSession = .shared) {
        self.authManager = authManager
        self.session = session
    }

    func generate(
        for activityIds: [String],
        repoFullName: String
    ) async throws -> CoachMessageAPIResponse {
        let canonicalIds = try Self.canonicalActivityIds(activityIds)
        guard authManager.repoFullName == repoFullName else {
            throw GitHubAPIError.sessionNotReady
        }
        guard let token = await authManager.validToken() else {
            throw GitHubAPIError.notAuthenticated
        }
        guard authManager.repoFullName == repoFullName else {
            throw GitHubAPIError.sessionNotReady
        }
        guard let url = URL(string: "\(Secrets.dashboardBaseURL)/api/coach-message") else {
            throw GitHubAPIError.decodingFailed(operation: "Coach message URL")
        }

        let body = try JSONEncoder().encode(ActivityIdsRequest(activityIds: canonicalIds))
        guard body.count <= Self.maximumPayloadBytes else {
            throw GitHubAPIError.decodingFailed(operation: "Coach message request is too large")
        }

        var request = URLRequest(url: url, timeoutInterval: 60)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(repoFullName, forHTTPHeaderField: "X-Coach-Repo")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await session.data(for: request)
        guard data.count <= Self.maximumPayloadBytes else {
            throw GitHubAPIError.decodingFailed(operation: "Coach message response is too large")
        }
        guard let http = response as? HTTPURLResponse else {
            throw GitHubAPIError.decodingFailed(operation: "Coach message response")
        }
        if http.statusCode == 401 { throw GitHubAPIError.notAuthenticated }
        guard (200...299).contains(http.statusCode) else {
            let detail = (try? JSONDecoder().decode(CoachMessageErrorBody.self, from: data))?.error
                ?? String(data: data, encoding: .utf8)
            throw GitHubAPIError.requestFailed(
                operation: "Generating Coach message",
                status: http.statusCode,
                detail: detail
            )
        }

        return try Self.decodeResponse(data, expectedActivityIds: canonicalIds)
    }

    static func canonicalActivityIds(_ activityIds: [String]) throws -> [String] {
        var canonical = Set<String>()
        for raw in activityIds {
            guard raw.count <= 80 else {
                throw GitHubAPIError.decodingFailed(operation: "Invalid Coach activity id")
            }
            if raw.hasPrefix("healthkit:"),
               let uuid = UUID(uuidString: String(raw.dropFirst("healthkit:".count))) {
                canonical.insert("healthkit:\(uuid.uuidString.uppercased())")
            } else if raw.hasPrefix("strava:") {
                let value = String(raw.dropFirst("strava:".count))
                guard value.range(
                    of: "^[0-9]{1,32}$",
                    options: .regularExpression
                ) != nil else {
                    throw GitHubAPIError.decodingFailed(operation: "Invalid Coach activity id")
                }
                canonical.insert("strava:\(value)")
            } else {
                throw GitHubAPIError.decodingFailed(operation: "Invalid Coach activity id")
            }
        }

        guard !canonical.isEmpty, canonical.count <= maximumActivityIds else {
            throw GitHubAPIError.decodingFailed(operation: "Coach activity batch is out of bounds")
        }
        return canonical.sorted()
    }

    static func decodeResponse(
        _ data: Data,
        expectedActivityIds: [String]
    ) throws -> CoachMessageAPIResponse {
        guard data.count <= maximumPayloadBytes else {
            throw GitHubAPIError.decodingFailed(operation: "Coach message response is too large")
        }
        let decoded: CoachMessageAPIResponse
        do {
            decoded = try JSONDecoder().decode(CoachMessageAPIResponse.self, from: data)
        } catch {
            throw GitHubAPIError.decodingFailed(operation: "Parsing Coach message response")
        }

        let message = decoded.message
        let bodyIsValid = !message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && message.body.count <= 360
        let idIsValid = !message.id.isEmpty && message.id.count <= 180
        let timestampIsValid = parseISO8601(message.createdAt) != nil
        guard decoded.delivered,
              !(decoded.idempotent && decoded.shouldNotify),
              idIsValid,
              message.id.range(
                of: "^cm-[A-Za-z0-9-]{1,160}$",
                options: .regularExpression
              ) != nil,
              bodyIsValid,
              timestampIsValid,
              message.activityIds == expectedActivityIds,
              message.conversationSeedId == "local-proactive-\(message.id)" else {
            throw GitHubAPIError.decodingFailed(operation: "Invalid Coach message response")
        }
        return decoded
    }

    private static func parseISO8601(_ raw: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: raw) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: raw)
    }

    private struct ActivityIdsRequest: Encodable {
        let activityIds: [String]

        enum CodingKeys: String, CodingKey {
            case activityIds = "activity_ids"
        }
    }

    private struct CoachMessageErrorBody: Decodable {
        let error: String?
    }
}

/// Keeps post-sync failure semantics testable without HealthKit or notification services.
enum CoachMessagePostSyncDelivery {
    static func run(
        activityIds: [String],
        repoFullName: String,
        client: CoachMessageGenerating,
        refreshSnapshots: () async -> Void,
        notify: (CoachMessageRecord) async -> Void
    ) async {
        guard let response = try? await client.generate(
            for: activityIds,
            repoFullName: repoFullName
        ) else { return }
        await refreshSnapshots()
        guard response.shouldNotify else { return }
        await notify(response.message)
    }
}
