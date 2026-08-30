import Foundation
import XCTest
import Sentry
@testable import CoachHQ

/// Proves that Rage Report events carry a stable, product-owned fingerprint that
/// overrides whatever UIKit frame Sentry would otherwise choose as the culprit.
final class RageReportGroupingTests: XCTestCase {

    func testFingerprintIsRageReport() {
        let scope = Scope()
        SentryRageReportSubmitter.apply(to: scope, operationID: UUID(), attachment: nil)
        let serialized = scope.serialize()
        XCTAssertEqual(
            serialized["fingerprint"] as? [String], ["rage_report"],
            "Rage Report must carry a fixed fingerprint so all reports group together"
        )
    }

    func testTwoReportsFromDifferentContextsProduceIdenticalFingerprints() {
        // Simulate two submits from different UIKit stacks (different operationIDs,
        // potentially different active responders). Their fingerprints must match so
        // Sentry groups them under the same issue rather than separate UIKit-culprit issues.
        let scope1 = Scope()
        let scope2 = Scope()

        SentryRageReportSubmitter.apply(to: scope1, operationID: UUID(), attachment: nil)
        SentryRageReportSubmitter.apply(to: scope2, operationID: UUID(), attachment: nil)

        let fp1 = scope1.serialize()["fingerprint"] as? [String]
        let fp2 = scope2.serialize()["fingerprint"] as? [String]
        XCTAssertEqual(fp1, fp2)
        XCTAssertEqual(fp1, ["rage_report"])
    }

    func testFingerprintIsTheSameWithAndWithoutAttachment() {
        let scope1 = Scope()
        let scope2 = Scope()
        let operationID = UUID()
        let attachment = RageReportAttachment(
            data: Data("{}".utf8),
            filename: "timeline.json",
            contentType: "application/json"
        )

        SentryRageReportSubmitter.apply(to: scope1, operationID: operationID, attachment: nil)
        SentryRageReportSubmitter.apply(to: scope2, operationID: operationID, attachment: attachment)

        let fp1 = scope1.serialize()["fingerprint"] as? [String]
        let fp2 = scope2.serialize()["fingerprint"] as? [String]
        XCTAssertEqual(fp1, fp2)
        XCTAssertEqual(fp1, ["rage_report"])
    }

    func testRequiredTagsArePreservedAlongsideFingerprint() {
        let scope = Scope()
        let operationID = UUID()
        SentryRageReportSubmitter.apply(to: scope, operationID: operationID, attachment: nil)

        let serialized = scope.serialize()
        XCTAssertEqual(serialized["fingerprint"] as? [String], ["rage_report"])

        let tags = serialized["tags"] as? [String: String]
        XCTAssertEqual(tags?["operation"], "rage_report")
        XCTAssertEqual(tags?["operation_id"], operationID.uuidString)
    }
}
