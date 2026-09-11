import SwiftUI

/// In-app main/side quest card. Moved here in W2 of docs/plans/ios-widget-modules.md —
/// renamed from `QuestWidget` to match the `…Card` convention (§4 of the LLD).
struct QuestCard: View {
    let size: WidgetSize
    let home: QuestSnapshot
    let small: QuestSnapshotS
    var compact: Bool = false

    private var fraction: Double {
        size == .s
            ? small.progressPercent / 100
            : (home.target > 0 ? home.completed / home.target : 0)
    }

    var body: some View {
        WarmCard(padding: compact ? 16 : 16) {
            VStack(alignment: .leading, spacing: compact ? 0 : 10) {
                MonoLabel("MAIN QUEST", size: compact ? 9 : 10)

                if compact {
                    Text(size == .s ? small.name : home.name)
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundColor(WarmInstrument.ink)
                        .lineLimit(2)
                        .padding(.top, 8)

                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(size == .s ? "\(Int(small.completed))" : questNumber(home.completed))
                            .font(WarmInstrument.figures(26, weight: .bold))
                            .foregroundColor(WarmInstrument.accent)
                        Text(size == .s ? " / \(Int(small.target))" : " / \(questNumber(home.target))")
                            .font(WarmInstrument.figures(11, weight: .semibold))
                            .foregroundColor(WarmInstrument.inkFaint)
                    }
                    .padding(.top, 4)

                    Spacer(minLength: 0)

                    HairlineProgress(fraction: fraction, height: 8)
                        .padding(.top, 14)

                    HStack {
                        Text("LOADED \(questNumber(home.loaded))")
                            .font(.system(size: 8, weight: .regular, design: .monospaced))
                            .foregroundColor(WarmInstrument.inkMuted)
                        Spacer()
                        Text("\(home.daysLeft)D LEFT")
                            .font(.system(size: 8, weight: .bold, design: .monospaced))
                            .foregroundColor(WarmInstrument.accent)
                    }
                    .padding(.top, 6)
                } else {
                    HStack(alignment: .firstTextBaseline) {
                        Text(size == .s ? small.name : home.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(WarmInstrument.ink)
                            .lineLimit(1)
                        Spacer()
                        HStack(alignment: .firstTextBaseline, spacing: 1) {
                            Text(size == .s ? "\(Int(small.completed))" : questNumber(home.completed))
                                .font(WarmInstrument.figures(18, weight: .bold))
                            Text(size == .s ? " / \(Int(small.target))" : " / \(questNumber(home.target))")
                                .font(WarmInstrument.figures(12, weight: .semibold))
                                .foregroundColor(WarmInstrument.inkFaint)
                        }
                        .foregroundColor(WarmInstrument.ink)
                        .contentTransition(.numericText())
                    }

                    HairlineProgress(fraction: fraction, height: 4)

                    if size != .s, !home.sideQuests.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            MonoLabel("SIDE QUESTS", size: 9)
                            ForEach(home.sideQuests.prefix(2), id: \.name) { side in
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack {
                                        Text(side.name)
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundColor(WarmInstrument.ink)
                                        Spacer()
                                        Text("\(Int(side.value))/\(Int(side.target))")
                                            .font(WarmInstrument.figures(11))
                                            .foregroundColor(WarmInstrument.inkMuted)
                                    }
                                    HairlineProgress(
                                        fraction: side.target > 0 ? side.value / side.target : 0,
                                        tint: WarmInstrument.color(hex: side.color),
                                        height: 3
                                    )
                                }
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: compact ? 148 : nil, alignment: .leading)
        }
    }

    private func questNumber(_ value: Double) -> String {
        value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value)
    }
}
