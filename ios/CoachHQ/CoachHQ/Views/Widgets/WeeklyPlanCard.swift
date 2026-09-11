import SwiftUI
import UniformTypeIdentifiers

/// In-app weekly plan strip — day slots + projection line. One file per widget, per ADR 0037.
///
/// **Not done here:** `daySlot` still redraws its icon-on-tint square inline instead of calling
/// `SportChip` (`WarmInstrumentAtoms.swift`) — see `ios/DESIGN.md`'s "Out of scope" for why.
struct WeeklyPlanCard: View {
    let plan: WeeklyPlanSnapshot
    var compact: Bool = false

    /// Local-only reorder state — resets to `plan.days` on next snapshot fetch. Writing the
    /// swap back to GitHub is listed as *Proposed* (not required) in the Design Philosophy's
    /// weekly-plan interaction note; this phase mirrors the web's client-side-only reorder.
    @State private var days: [PlanDaySnapshot]
    @State private var dragIndex: Int?

    init(plan: WeeklyPlanSnapshot, compact: Bool = false) {
        self.plan = plan
        self.compact = compact
        _days = State(initialValue: plan.days)
    }

    private var projection: (label: String, isOver: Bool) {
        let known = days.compactMap(\.loadDelta)
        guard !known.isEmpty else { return ("Projection unavailable", false) }
        let total = known.reduce(0, +)
        guard let low = plan.bandLow, let high = plan.bandHigh else {
            return ("Projected ≈\(Int(total)) — band unavailable.", false)
        }
        if total > high { return ("Projected ≈\(Int(total)) — over the band. Ease off.", true) }
        if total < low { return ("Projected ≈\(Int(total)) — below the band.", false) }
        return ("Projected ≈\(Int(total)) — in the band.", false)
    }

    var body: some View {
        WarmCard(padding: compact ? 18 : 16, dashed: true) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    MonoLabel(plan.title ?? "WEEKLY PLAN", size: compact ? 10 : 10)
                    Spacer()
                    Text(plan.statusLabel ?? (plan.isPreview ? "COACH DRAFT" : plan.label))
                        .font(WarmInstrument.monoLabel(9))
                        .tracking(1.0)
                        .foregroundColor(WarmInstrument.inkMuted)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .strokeBorder(WarmInstrument.headerRule, lineWidth: 1)
                        )
                }

                HStack(spacing: compact ? 7 : 6) {
                    ForEach(Array(days.enumerated()), id: \.element.key) { index, day in
                        daySlot(day, index: index)
                    }
                }

                if !compact {
                    Text(projection.label)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(projection.isOver ? WarmInstrument.accent : WarmInstrument.inkMuted)
                }
            }
        }
        .onChange(of: plan.days.map(\.key)) { _, _ in days = plan.days }
    }

    private func daySlot(_ day: PlanDaySnapshot, index: Int) -> some View {
        VStack(spacing: 4) {
            Text(String(day.dayShort.prefix(1)))
                .font(.system(size: compact ? 8.5 : 9, weight: .bold, design: .monospaced))
                .foregroundColor(WarmInstrument.inkFaint)

            Group {
                if let glyph = day.glyph {
                    Image(systemName: WarmInstrument.sfSymbol(for: glyph))
                        .font(.system(size: compact ? 14 : 13, weight: .semibold))
                        .foregroundColor(sportTint(day))
                } else if compact {
                    Color.clear
                } else {
                    Text("REST")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundColor(WarmInstrument.inkFaint)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: compact ? 26 : 38)
            .background(sportTint(day).opacity(day.glyph != nil ? 0.1 : 0))
            .clipShape(RoundedRectangle(cornerRadius: compact ? 5 : 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: compact ? 5 : 10, style: .continuous)
                    .strokeBorder(
                        day.glyph != nil
                            ? sportTint(day).opacity(0.35)
                            : (compact ? WarmInstrument.border.opacity(0.5) : WarmInstrument.border),
                        style: day.glyph == nil && compact ? StrokeStyle(lineWidth: 1, dash: [4, 3]) : StrokeStyle(lineWidth: 1)
                    )
            )
            .overlay(alignment: .bottom) {
                if !compact, let delta = day.loadDelta {
                    Text("+\(Int(delta))")
                        .font(.system(size: 8, weight: .semibold, design: .monospaced))
                        .foregroundColor(WarmInstrument.inkMuted)
                        .offset(y: 14)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onDrag {
            guard days[index].glyph != nil else { return NSItemProvider() }
            dragIndex = index
            return NSItemProvider(object: String(index) as NSString)
        }
        .onDrop(of: [.text], delegate: PlanDropDelegate(index: index, days: $days, dragIndex: $dragIndex))
    }

    private func sportTint(_ day: PlanDaySnapshot) -> Color {
        guard day.glyph != nil, let sportId = WarmSportId(rawValue: day.sport) else { return WarmInstrument.inkFaint }
        return WarmInstrument.sportColor(sportId)
    }
}

private struct PlanDropDelegate: DropDelegate {
    let index: Int
    @Binding var days: [PlanDaySnapshot]
    @Binding var dragIndex: Int?

    func performDrop(info: DropInfo) -> Bool {
        defer { dragIndex = nil }
        guard let from = dragIndex, from != index, days[from].glyph != nil else { return false }
        Haptics.tap()
        days.swapAt(from, index)
        return true
    }

    func dropEntered(info: DropInfo) {}
}
