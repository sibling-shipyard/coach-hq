import XCTest
@testable import CoachHQ

final class HRZoneStoreTests: XCTestCase {
    private func isolatedDefaults() -> (UserDefaults, String) {
        let name = "HRZoneStoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return (defaults, name)
    }

    private func fileData(
        boundaries: [Int],
        source: HRZoneFile.Source = .override,
        method: String = "stored_v1"
    ) throws -> Data {
        try HRZoneStore.encode(HRZoneFile(
            version: 1,
            metadata: .init(updatedAt: "2026-08-23T09:12:00Z", updatedBy: "ios-sync"),
            source: source,
            method: method,
            inputs: .init(),
            boundaries: boundaries
        ))
    }

    func testMissingFileSeedsCustomizedLegacyValuesAsOverride() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set(120, forKey: HRZoneConfig.zone1UpperKey)
        defaults.set(140, forKey: HRZoneConfig.zone2UpperKey)
        defaults.set(155, forKey: HRZoneConfig.zone3UpperKey)
        defaults.set(170, forKey: HRZoneConfig.zone4UpperKey)
        let store = HRZoneStore(
            defaults: defaults,
            now: { Date(timeIntervalSince1970: 1_700_000_000) }
        )

        let seed = try await store.prepareForSync {
            throw GitHubAPIError.notFound(operation: "Reading zones")
        }

        let file = try HRZoneStore.decode(XCTUnwrap(seed?.data))
        XCTAssertEqual(seed?.path, HRZoneStore.path)
        XCTAssertEqual(file.source, .override)
        XCTAssertEqual(file.boundaries, [120, 140, 155, 170])
        XCTAssertTrue(defaults.bool(forKey: HRZoneStore.customZonesEnabledKey))
    }

    func testRepoOverrideRestoresAfterFreshInstall() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let store = HRZoneStore(defaults: defaults)
        let data = try fileData(boundaries: [120, 140, 155, 170])

        let seed = try await store.prepareForSync { data }

        XCTAssertNil(seed)
        XCTAssertEqual(
            HRZoneConfig.current(in: defaults),
            HRZoneConfig(zone1Upper: 120, zone2Upper: 140, zone3Upper: 155, zone4Upper: 170)
        )
        XCTAssertTrue(defaults.bool(forKey: HRZoneStore.customZonesEnabledKey))
    }

    func testNonIncreasingRepoFileIsIgnoredByTheIOSReader() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let custom = HRZoneConfig(zone1Upper: 120, zone2Upper: 140, zone3Upper: 155, zone4Upper: 170)
        defaults.set(try JSONEncoder().encode(custom.boundaries), forKey: HRZoneConfig.mirrorKey)
        defaults.set(custom.zone1Upper, forKey: HRZoneConfig.zone1UpperKey)
        defaults.set(custom.zone2Upper, forKey: HRZoneConfig.zone2UpperKey)
        defaults.set(custom.zone3Upper, forKey: HRZoneConfig.zone3UpperKey)
        defaults.set(custom.zone4Upper, forKey: HRZoneConfig.zone4UpperKey)
        defaults.set(true, forKey: HRZoneStore.customZonesEnabledKey)
        let store = HRZoneStore(defaults: defaults)
        let data = try fileData(boundaries: [120, 140, 140, 170])

        let seed = try await store.prepareForSync { data }

        XCTAssertNil(seed, "an invalid existing file is ignored, not overwritten")
        XCTAssertEqual(HRZoneConfig.current(in: defaults), custom)
        XCTAssertTrue(defaults.bool(forKey: HRZoneStore.customZonesEnabledKey))
    }

    func testFutureMethodUsesValidStoredBoundaries() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let store = HRZoneStore(defaults: defaults)
        let data = try fileData(
            boundaries: [121, 141, 156, 171],
            method: "karvonen_p95_v1"
        )

        let seed = try await store.prepareForSync { data }

        XCTAssertNil(seed)
        XCTAssertEqual(HRZoneConfig.current(in: defaults).boundaries, [121, 141, 156, 171])
        XCTAssertTrue(defaults.bool(forKey: HRZoneStore.customZonesEnabledKey))
    }

    func testTransientRepoReadPreservesCurrentZones() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let custom = HRZoneConfig(zone1Upper: 120, zone2Upper: 140, zone3Upper: 155, zone4Upper: 170)
        let store = HRZoneStore(defaults: defaults)
        _ = try store.settingsFile(custom: true, config: custom)

        let seed = try await store.prepareForSync {
            throw URLError(.networkConnectionLost)
        }

        XCTAssertNil(seed)
        XCTAssertEqual(HRZoneConfig.current(in: defaults), custom)
        XCTAssertTrue(defaults.bool(forKey: HRZoneStore.customZonesEnabledKey))
    }

    func testServerFailurePreservesCurrentZones() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let custom = HRZoneConfig(zone1Upper: 120, zone2Upper: 140, zone3Upper: 155, zone4Upper: 170)
        let store = HRZoneStore(defaults: defaults)
        _ = try store.settingsFile(custom: true, config: custom)

        let seed = try await store.prepareForSync {
            throw GitHubAPIError.requestFailed(
                operation: "Reading zones",
                status: 500,
                detail: "Server error"
            )
        }

        XCTAssertNil(seed)
        XCTAssertEqual(HRZoneConfig.current(in: defaults), custom)
        XCTAssertTrue(defaults.bool(forKey: HRZoneStore.customZonesEnabledKey))
    }

    func testSettingsWriterRejectsNonIncreasingBoundaries() async {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let store = HRZoneStore(defaults: defaults)
        let invalid = HRZoneConfig(
            zone1Upper: 150,
            zone2Upper: 140,
            zone3Upper: 155,
            zone4Upper: 170
        )

        XCTAssertFalse(invalid.isStrictlyIncreasing)
        XCTAssertThrowsError(try store.settingsFile(custom: true, config: invalid))
    }

    func testAbsentRepoKeepsZoneIntegrationByteIdentical() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let store = HRZoneStore(defaults: defaults)
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let end = start.addingTimeInterval(180)
        let samples = [
            (date: start, bpm: 130.0),
            (date: start.addingTimeInterval(60), bpm: 140.0),
            (date: start.addingTimeInterval(120), bpm: 160.0),
        ]
        let before = HRAnalysis.integrateZones(
            samples: samples,
            config: .default,
            start: start,
            end: end
        )

        _ = try await store.prepareForSync {
            throw GitHubAPIError.notFound(operation: "Reading zones")
        }
        let after = HRAnalysis.integrateZones(
            samples: samples,
            config: HRZoneConfig.current(in: defaults),
            start: start,
            end: end
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]

        XCTAssertEqual(try encoder.encode(before.zones), try encoder.encode(after.zones))
    }

    func testEncodedSchemaKeepsFutureInputsExplicitlyNull() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let store = HRZoneStore(
            defaults: defaults,
            now: { Date(timeIntervalSince1970: 1_700_000_000) }
        )

        let output = try store.settingsFile(custom: false, config: .default)
        let json = String(decoding: output.data, as: UTF8.self)

        XCTAssertTrue(json.contains("\"max_hr\" : null"))
        XCTAssertTrue(json.contains("\"resting_hr\" : null"))
        XCTAssertEqual(try HRZoneStore.decode(output.data).source, .derived)
    }

    func testZoneSaveDuringActiveSyncQueuesLatestFileWithoutWaiting() async throws {
        let (defaults, name) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: name) }
        let first = HRZoneConfig(zone1Upper: 120, zone2Upper: 140, zone3Upper: 155, zone4Upper: 170)
        let latest = HRZoneConfig(zone1Upper: 121, zone2Upper: 141, zone3Upper: 156, zone4Upper: 171)
        let manager = HealthKitSyncManager(hrZoneStore: HRZoneStore(defaults: defaults))
        manager.isSyncing = true

        await manager.saveHRZoneSettings(custom: true, config: first)
        await manager.saveHRZoneSettings(custom: true, config: latest)

        let queued = try XCTUnwrap(manager.pendingHRZoneFile)
        XCTAssertEqual(queued.path, HRZoneStore.path)
        XCTAssertEqual(try HRZoneStore.decode(queued.data).boundaries, latest.boundaries)
        XCTAssertTrue(manager.isSyncing)
        XCTAssertEqual(HRZoneConfig.current(in: defaults), latest)
        XCTAssertTrue(defaults.bool(forKey: HRZoneStore.customZonesEnabledKey))
    }
}
