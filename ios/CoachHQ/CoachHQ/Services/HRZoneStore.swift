import Foundation

struct HRZoneFile: Codable, Equatable {
    struct Metadata: Codable, Equatable {
        let updatedAt: String
        let updatedBy: String

        enum CodingKeys: String, CodingKey {
            case updatedAt = "updated_at"
            case updatedBy = "updated_by"
        }
    }

    struct Inputs: Codable, Equatable {
        let maxHR: Int? = nil
        let restingHR: Int? = nil

        enum CodingKeys: String, CodingKey {
            case maxHR = "max_hr"
            case restingHR = "resting_hr"
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeNil(forKey: .maxHR)
            try container.encodeNil(forKey: .restingHR)
        }
    }

    enum Source: String, Codable, Equatable {
        case derived
        case override
    }

    let version: Int
    let metadata: Metadata
    let source: Source
    let method: String
    let inputs: Inputs
    let boundaries: [Int]

    enum CodingKeys: String, CodingKey {
        case version
        case metadata = "_meta"
        case source
        case method
        case inputs
        case boundaries
    }
}

final class HRZoneStore {
    static let path = "user_data/health/zones.json"
    static let customZonesEnabledKey = "customHRZonesEnabled"

    private let defaults: UserDefaults
    private let now: () -> Date

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.now = now
    }

    /// Reads and mirrors the repo file. A missing file is seeded through the caller's existing
    /// atomic sync path; malformed content is ignored and never overwritten implicitly.
    func prepareForSync(
        read: () async throws -> Data
    ) async throws -> (path: String, data: Data)? {
        do {
            let data = try await read()
            if let file = try? Self.decode(data) {
                mirror(file)
            }
            return nil
        } catch let error as GitHubAPIError {
            guard case .notFound = error else { return nil }
            let config = HRZoneConfig.legacy(in: defaults)
            let source: HRZoneFile.Source = config == .default ? .derived : .override
            let file = makeFile(config: config, source: source)
            mirror(file)
            return (Self.path, try Self.encode(file))
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw error
        } catch {
            return nil
        }
    }

    func settingsFile(custom: Bool, config: HRZoneConfig) throws -> (path: String, data: Data) {
        let chosen = custom ? config : .default
        guard chosen.isStrictlyIncreasing else { throw HRZoneStoreError.invalidBoundaries }
        let source: HRZoneFile.Source = custom ? .override : .derived
        let file = makeFile(config: chosen, source: source)
        mirror(file)
        return (Self.path, try Self.encode(file))
    }

    static func decode(_ data: Data) throws -> HRZoneFile {
        let file = try JSONDecoder().decode(HRZoneFile.self, from: data)
        guard file.version == 1,
              HRZoneConfig(boundaries: file.boundaries) != nil
        else { throw HRZoneStoreError.invalidBoundaries }
        return file
    }

    static func encode(_ file: HRZoneFile) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(file)
    }

    private func makeFile(config: HRZoneConfig, source: HRZoneFile.Source) -> HRZoneFile {
        HRZoneFile(
            version: 1,
            metadata: .init(
                updatedAt: ISO8601DateFormatter().string(from: now()),
                updatedBy: "ios-sync"
            ),
            source: source,
            method: "stored_v1",
            inputs: .init(),
            boundaries: config.boundaries
        )
    }

    private func mirror(_ file: HRZoneFile) {
        guard let config = HRZoneConfig(boundaries: file.boundaries) else {
            mirror(config: .default, source: .derived)
            return
        }
        mirror(config: config, source: file.source)
    }

    private func mirror(config: HRZoneConfig, source: HRZoneFile.Source) {
        if let data = try? JSONEncoder().encode(config.boundaries) {
            defaults.set(data, forKey: HRZoneConfig.mirrorKey)
        }
        defaults.set(config.zone1Upper, forKey: HRZoneConfig.zone1UpperKey)
        defaults.set(config.zone2Upper, forKey: HRZoneConfig.zone2UpperKey)
        defaults.set(config.zone3Upper, forKey: HRZoneConfig.zone3UpperKey)
        defaults.set(config.zone4Upper, forKey: HRZoneConfig.zone4UpperKey)
        defaults.set(source == .override, forKey: Self.customZonesEnabledKey)
    }
}

enum HRZoneStoreError: Error {
    case invalidBoundaries
}
