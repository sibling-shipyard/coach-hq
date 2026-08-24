import Foundation

/// Per-install identity. Prod / Dev / Staging are separate apps on the same phone
/// (different bundle IDs). Values come from the target's build settings via Info.plist
/// so the widget extension and the app stay aligned without a compile-time flag.
enum AppIdentity {
    static var urlScheme: String {
        Bundle.main.object(forInfoDictionaryKey: "CoachHQURLScheme") as? String ?? "coachhq"
    }

    static var appGroupID: String {
        Bundle.main.object(forInfoDictionaryKey: "CoachHQAppGroup") as? String
            ?? "group.com.siblingshipyard.coachhq.ios"
    }
}
