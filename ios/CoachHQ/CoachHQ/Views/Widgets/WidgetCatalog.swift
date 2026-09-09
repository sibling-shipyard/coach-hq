import Foundation

/// Which Home widgets exist, and the default order they render in. W6 of
/// docs/plans/ios-widget-modules.md: Home's column becomes stored data (`WarmInstrumentHomeView
/// .homeOrder`) keyed through this catalog, instead of a hardcoded sequence of view calls.
///
/// Local-only today — a future server-provided order (P2 in the plan's LLD) would just replace
/// what populates the stored order, not this type. `RawRepresentable` on `String` means an
/// unrecognized key (one this build doesn't know yet) fails to match and is silently dropped by
/// `WarmInstrumentHomeView.homeOrder`'s `compactMap`, never a crash.
enum WidgetCatalogKey: String, CaseIterable {
    case engine
    case commitments
    case weeklyPlan
    case caloriesAndQuest
    case buildPhase
    case recentSessions

    static let defaultOrder: [WidgetCatalogKey] = [
        .engine, .commitments, .weeklyPlan, .caloriesAndQuest, .buildPhase, .recentSessions,
    ]

    /// `@AppStorage` (`WarmInstrumentHomeView.homeOrderRaw`) can't hold `[WidgetCatalogKey]`
    /// directly, so the stored form is this comma-joined raw-value string. Pure, so the "unknown
    /// key is dropped, not a crash" behaviour is directly testable.
    static func parseOrder(_ raw: String) -> [WidgetCatalogKey] {
        raw.split(separator: ",").compactMap { WidgetCatalogKey(rawValue: String($0)) }
    }

    static func encodeOrder(_ order: [WidgetCatalogKey]) -> String {
        order.map(\.rawValue).joined(separator: ",")
    }
}
