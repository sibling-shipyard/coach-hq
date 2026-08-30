import Foundation
import Sentry

struct RageReportAttachment: Equatable {
    let data: Data
    let filename: String
    let contentType: String
}

protocol RageReportSubmitting {
    func submit(message: String, attachment: RageReportAttachment?) throws
}

enum RageReportSubmissionError: Error {
    case notQueued
}

struct SentryRageReportSubmitter: RageReportSubmitting {
    func submit(message: String, attachment: RageReportAttachment?) throws {
        let operationID = UUID()
        let eventID = SentrySDK.capture(message: message) { scope in
            scope.setTag(value: "rage_report", key: "operation")
            scope.setTag(value: operationID.uuidString, key: "operation_id")
            scope.setExtra(value: attachment != nil, key: "timeline_attached")
            scope.setExtra(value: attachment?.data.count ?? 0, key: "timeline_bytes")
            guard let attachment else { return }
            scope.addAttachment(
                Attachment(
                    data: attachment.data,
                    filename: attachment.filename,
                    contentType: attachment.contentType
                )
            )
        }

        guard !eventID.isEqual(SentryId.empty) else {
            throw RageReportSubmissionError.notQueued
        }
    }
}
