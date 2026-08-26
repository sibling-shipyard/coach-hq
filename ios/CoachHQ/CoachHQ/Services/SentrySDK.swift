import Foundation

struct Attachment {
    let data: Data
    let filename: String
    let contentType: String
}

class Event {
    var message: SentryMessage?
}

class SentryMessage {
    var message: String
    init(formatted: String) {
        self.message = formatted
    }
}

class SentrySDK {
    static var capturedMessages: [(message: String, attachments: [Attachment])] = []
    
    static func capture(message: String, configureScope: ((Scope) -> Void)? = nil) {
        let scope = Scope()
        configureScope?(scope)
        capturedMessages.append((message, scope.attachments))
    }
}

class Scope {
    var attachments: [Attachment] = []
    func addAttachment(_ attachment: Attachment) {
        attachments.append(attachment)
    }
}
