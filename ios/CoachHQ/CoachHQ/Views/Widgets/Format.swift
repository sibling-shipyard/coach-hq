import SwiftUI

/// W4 of docs/plans/ios-widget-modules.md — the shared number formatter, the "Xh Ym"/"Xm"
/// duration formatter, and the parameterized stat-cell view that five to four different files
/// each hand-rolled their own copy of.
enum Format {
    /// "int if whole, else 1dp" — was written 5 times (`numberString`, `questNumber`, `loadLabel`,
    /// and one each in `SportStripCell`/`SportCube`). Every call site had the identical body.
    static func number(_ value: Double) -> String {
        value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }

    /// "1h 30m" (or "45m" under an hour) from a duration in seconds. Folds
    /// `ActivityFeedVariants.durationLabel`/`timeString` and `HealthSettingsView.durationLabel` —
    /// all three were the identical `Xh Ym`/`Xm` shape, just with different input types
    /// (`Int` seconds vs `TimeInterval`) and one missing the `max(0, ...)` guard.
    ///
    /// **Not folded here:** `ActivityDetailView.durationString` ("3h05", no space, always
    /// 2-digit minutes) is a different displayed format, not just a different implementation —
    /// folding it would change what the hero stat reads, so it's left alone (P2 in the LLD).
    /// `WorkoutTimerWarm.formatTimer` ("03:45" mm:ss) is a live countdown/elapsed readout, a
    /// different domain from a historical duration label — also left alone.
    static func duration(seconds: Int) -> String {
        let minutes = max(0, seconds) / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    static func duration(_ interval: TimeInterval) -> String {
        duration(seconds: Int(interval.rounded()))
    }
}

/// One bold monospaced value + small mono-caption label, leading-aligned. Folds
/// `WeekStatCell` (`ActivityFeedVariants.swift`), `SupportingStatCell` (`ActivityDetailView.swift`),
/// and `BigStat` (`OnboardingRevealFlow.swift`) — same shape, different sizes/spacing per surface.
struct StatCell: View {
    let value: String
    let label: String
    var valueFont: Font
    var valueColor: Color = WarmInstrument.ink
    /// `BigStat` didn't animate its value and used `minimumScaleFactor`/`lineLimit` instead —
    /// the other two animate via `.contentTransition(.numericText())` and don't scale/clamp.
    var animatesValue: Bool = true
    var minimumScaleFactor: CGFloat = 1
    var valueLineLimit: Int? = nil
    var labelSize: CGFloat = 9
    var labelColor: Color = WarmInstrument.inkMuted
    /// `BigStat`'s label used `.kerning(1.2)`; `MonoLabel` (used here for all three) only
    /// exposes `.tracking(_:)`. Visually near-identical at 9pt — tracking reflows evenly where
    /// kerning only nudges specific pairs — noted since it's the one non-identical fold below.
    var labelTracking: CGFloat = 1.1
    var spacing: CGFloat = 2
    /// `WeekStatCell`/`SupportingStatCell` stretched to fill their row; `BigStat` sized to
    /// content inside its own layout. Kept as a parameter rather than assumed.
    var stretchToFill: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            Text(value)
                .font(valueFont)
                .foregroundColor(valueColor)
                .contentTransition(animatesValue ? .numericText() : .identity)
                .minimumScaleFactor(minimumScaleFactor)
                .lineLimit(valueLineLimit)
            MonoLabel(label, size: labelSize, color: labelColor, tracking: labelTracking)
        }
        .frame(maxWidth: stretchToFill ? .infinity : nil, alignment: .leading)
    }
}
