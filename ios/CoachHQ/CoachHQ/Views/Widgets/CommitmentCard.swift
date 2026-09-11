import SwiftUI

/// In-app sport commitment strip — one file per widget, per ADR 0037.
struct CommitmentCard: View {
    let size: WidgetSize
    let sizes: CommitmentSizes
    @Binding var showingRanked: Bool

    var body: some View {
        if size == .s {
            WarmCard {
                SportCube(commitment: sizes.S)
            }
        } else if sizes.M.isEmpty {
            WarmCard {
                Text("No commitments configured yet.")
                    .font(.system(size: 12))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        } else {
            WarmCard(padding: 0) {
                HStack(spacing: 0) {
                    ForEach(Array(sizes.M.enumerated()), id: \.element.id) { index, item in
                        SportStripCell(
                            commitment: item,
                            showingRanked: item.id == "badminton" ? showingRanked : false,
                            onToggle: item.id == "badminton" && item.hasRankedRecord == true
                                ? { showingRanked.toggle() }
                                : nil
                        )
                        .overlay(alignment: .trailing) {
                            if index < sizes.M.count - 1 {
                                Rectangle()
                                    .fill(WarmInstrument.border.opacity(0.7))
                                    .frame(width: 1)
                            }
                        }
                    }
                }
            }
        }
    }
}
