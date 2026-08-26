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
        let eventID = SentrySDK.capture(message: message) { scope in
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
