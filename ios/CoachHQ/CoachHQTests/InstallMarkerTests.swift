import XCTest
import Foundation
@testable import CoachHQ

final class InstallMarkerTests: XCTestCase {
    func testMigrationAndReinstallAreDistinctFromDefaultsReset() {
        let suite = "install-marker-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        let marker = directory.appendingPathComponent("install-marker")
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }

        defaults.set(true, forKey: InstallMarker.legacyKey)
        var wipes = 0
        let prepare = { InstallMarker.prepare(at: marker, defaults: defaults) { wipes += 1 } }
        XCTAssertEqual(prepare(), .migrated)
        XCTAssertEqual(wipes, 0)
        defaults.removeObject(forKey: InstallMarker.legacyKey)
        XCTAssertEqual(prepare(), .existing)
        XCTAssertEqual(wipes, 0)

        try? FileManager.default.removeItem(at: directory)
        XCTAssertEqual(prepare(), .freshInstall)
        XCTAssertEqual(wipes, 1)
    }

    func testFailedMarkerWriteDoesNotTurnFreshInstallIntoMigration() throws {
        let suite = "install-marker-failure-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(suite, isDirectory: true)
        let blockedParent = directory.appendingPathComponent("blocked")
        let marker = blockedParent.appendingPathComponent("install-marker")
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data().write(to: blockedParent)

        var wipes = 0
        XCTAssertEqual(InstallMarker.prepare(at: marker, defaults: defaults) { wipes += 1 }, .unavailable)
        XCTAssertFalse(defaults.bool(forKey: InstallMarker.legacyKey))
        try? FileManager.default.removeItem(at: blockedParent)
        XCTAssertEqual(InstallMarker.prepare(at: marker, defaults: defaults) { wipes += 1 }, .freshInstall)
        XCTAssertEqual(wipes, 2)
    }
}
