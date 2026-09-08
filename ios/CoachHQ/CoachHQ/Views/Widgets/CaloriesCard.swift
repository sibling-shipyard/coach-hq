import SwiftUI

/// In-app monthly calories card. Moved here in W3b of docs/plans/ios-widget-modules.md —
/// renamed from `CaloriesWidget` to match the `…Card` convention (ADR 0037).
struct CaloriesCard: View {
    let calories: CaloriesSnapshot
    var compact: Bool = false

    /// Issue #68: the live pipeline can still ship a fabricated 12,000 kcal target with
    /// `targetIsFixture: false`, as if it were earned. Gate on all three signals — no target,
    /// an explicit fixture flag, or the known hardcoded value — so Home never renders it as
    /// real regardless of whether the upstream field is trustworthy yet.
    private static let knownFixtureHardcode: Double = 12_000

    private var hasTarget: Bool {
        guard let target = calories.target, target > 0 else { return false }
        if calories.targetIsFixture == true { return false }
        if target == Self.knownFixtureHardcode { return false }
        return true
    }

    private var progress: Double {
        hasTarget ? min(1, calories.current / calories.target!) : min(1, calories.pacePercent / 100)
    }

    var body: some View {
        WarmCard(padding: compact ? 16 : 16) {
            VStack(alignment: .leading, spacing: compact ? 0 : 10) {
                HStack {
                    MonoLabel("CALORIES · \(calories.monthLabel)", size: compact ? 9 : 10)
                    if !compact {
                        Spacer()
                        MonoLabel("\(calories.daysLeft)D LEFT")
                    }
                }

                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(compact(calories.current))
                        .font(WarmInstrument.figures(26, weight: .bold))
                        .foregroundColor(WarmInstrument.ink)
                        .contentTransition(.numericText())
                    Text(hasTarget ? "/ \(compact(calories.target!))" : "KCAL")
                        .font(WarmInstrument.figures(compact ? 11 : 11, weight: .regular))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
                .padding(.top, compact ? 10 : 0)

                ZStack(alignment: .leading) {
                    HairlineProgress(fraction: progress, tint: WarmInstrument.accent, height: compact ? 8 : 6)
                    GeometryReader { geo in
                        Rectangle()
                            .fill(WarmInstrument.ink)
                            .frame(width: 2, height: compact ? 12 : 6)
                            .offset(x: geo.size.width * CGFloat(min(1, calories.pacePercent / 100)) - 1, y: compact ? -2 : 0)
                    }
                    .frame(height: compact ? 8 : 6)
                }
                .padding(.top, compact ? 14 : 0)

                if compact {
                    HStack {
                        Text(hasTarget && calories.dailyNeeded != nil
                             ? "\(Int(calories.dailyNeeded!))/DAY"
                             : "MONTH TO DATE")
                            .font(.system(size: 8, weight: .bold, design: .monospaced))
                            .foregroundColor(WarmInstrument.accent)
                        Spacer()
                        Text("\(calories.daysLeft)D LEFT")
                            .font(.system(size: 8, weight: .regular, design: .monospaced))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                    .padding(.top, 6)
                } else {
                    Text(hasTarget && calories.dailyNeeded != nil
                         ? "\(Int(calories.dailyNeeded!))/DAY NEEDED"
                         : "MONTH TO DATE")
                        .font(.system(size: 9, weight: .bold, design: .monospaced))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: compact ? 148 : nil, alignment: .leading)
        }
    }

    private func compact(_ value: Double) -> String {
        value >= 1000 ? String(format: "%.1fK", value / 1000) : "\(Int(value))"
    }
}
