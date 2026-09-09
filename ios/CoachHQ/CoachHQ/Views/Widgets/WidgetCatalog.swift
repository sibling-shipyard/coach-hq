import Foundation

/// Which Home widgets exist, and the default order they render in. Home's column
/// (`WarmInstrumentHomeView.homeOrder`) is stored data keyed through this catalog, not a
/// hardcoded sequence of view calls.
///
/// Local-only today — a future server-provided order would just replace what populates the
/// stored order, not this type. `RawRepresentable` on `String` means an unrecognized key (one
/// this build doesn't know yet) fails to match and is silently dropped by
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
    /// directly, so the stored form is this comma-joined raw-value string. Pure, so both the
    /// "unknown key is dropped, not a crash" and "missing key is appended" behaviours below are
    /// directly testable.
    ///
    /// A `defaultOrder` key absent from `raw` — added to the catalog after this device last
    /// wrote its stored order — is appended at the end, in `defaultOrder`'s relative order. Ships
    /// with local-only storage, `parseOrder` runs on the athlete's own device on every load: with
    /// no rewrite step, a newly cataloged widget would otherwise never reach an existing install.
    static func parseOrder(_ raw: String) -> [WidgetCatalogKey] {
        let stored = raw.split(separator: ",").compactMap { WidgetCatalogKey(rawValue: String($0)) }
        let missing = defaultOrder.filter { !stored.contains($0) }
        return stored + missing
    }

    static func encodeOrder(_ order: [WidgetCatalogKey]) -> String {
        order.map(\.rawValue).joined(separator: ",")
    }
}
