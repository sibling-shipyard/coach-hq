import SwiftUI

/// In-app build-phase rail card. Moved here in W2 of docs/plans/ios-widget-modules.md —
/// renamed from `BuildPhaseWidget` to match the `…Card` convention (§4 of the LLD). Its rail
/// colors are `WarmInstrument.buildPhaseDeload`/`buildPhaseUpcoming` (W4) — the still-live
/// WidgetKit `CoachHQWidget/BuildPhaseWidget.swift` had the identical two hex literals hardcoded
/// too; both now point at the same tokens.
struct BuildPhaseCard: View {
    let phase: BuildPhaseSnapshot

    private let railLabels = ["BLOCK 1", "DELOAD", "BLOCK 2", "TEST"]
    private let railFlex: [CGFloat] = [4, 1.2, 4, 1.2]

    var body: some View {
        WarmCard(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    MonoLabel(phase.title ?? "BUILD PHASE", size: 10)
                    Spacer()
                    MonoLabel(phase.weekLabel, size: 9.5, color: WarmInstrument.accent)
                }

                VStack(spacing: 6) {
                    HStack(spacing: 3) {
                        ForEach(0..<4, id: \.self) { index in
                            phaseRailSegment(index: index)
                                .frame(maxWidth: .infinity)
                                .layoutPriority(railFlex[index])
                        }
                    }
                    .frame(height: 9)

                    HStack(spacing: 3) {
                        ForEach(Array(railLabels.enumerated()), id: \.offset) { index, label in
                            Text(label)
                                .font(.system(size: 8, weight: .regular, design: .monospaced))
                                .foregroundColor(WarmInstrument.inkFaint)
                                .frame(maxWidth: .infinity, alignment: index == railLabels.count - 1 ? .trailing : .leading)
                                .layoutPriority(railFlex[index])
                        }
                    }
                    .frame(height: 12)
                }

                if phase.milestones.isEmpty {
                    Text("No milestones tracked for this block yet.")
                        .font(.system(size: 12))
                        .foregroundColor(WarmInstrument.inkMuted)
                } else {
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(phase.milestones.prefix(2), id: \.name) { milestone in
                            HStack(alignment: .firstTextBaseline) {
                                Text(milestone.name)
                                    .font(.system(size: 12.5, weight: .semibold))
                                    .foregroundColor(WarmInstrument.ink)
                                    .lineLimit(1)
                                Spacer(minLength: 8)
                                milestoneLine(milestone)
                            }
                        }
                    }
                }

                Text(phase.read)
                    .font(WarmInstrument.coachVoice(14))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func phaseRailSegment(index: Int) -> some View {
        switch index {
        case 0:
            ZStack(alignment: .trailing) {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(WarmInstrument.accent)
                Rectangle()
                    .fill(WarmInstrument.ink)
                    .frame(width: 2, height: 15)
                    .offset(x: -4, y: -3)
            }
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
        case 1:
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(WarmInstrument.buildPhaseDeload)
        case 2:
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .strokeBorder(WarmInstrument.buildPhaseUpcoming, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        default:
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .strokeBorder(WarmInstrument.accent.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
        }
    }

    @ViewBuilder
    private func milestoneLine(_ milestone: PhaseMilestoneSnapshot) -> some View {
        let current = milestone.current ?? milestone.baseline
        HStack(spacing: 4) {
            Text(current)
            Text("→")
            if let projected = milestone.projectedDateLabel {
                Text("\(milestone.target) · \(projected.uppercased())")
                    .foregroundColor(WarmInstrument.accent)
            } else {
                Text(milestone.target)
                    .foregroundColor(WarmInstrument.accent)
            }
        }
        .font(WarmInstrument.figures(10))
        .foregroundColor(WarmInstrument.inkMuted)
        .lineLimit(1)
    }
}
