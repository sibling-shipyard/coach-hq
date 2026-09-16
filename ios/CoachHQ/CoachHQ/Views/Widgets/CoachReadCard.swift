import SwiftUI

/// In-app "Coach's read" card — date-stamped commentary + signature. One file per widget, per
/// ADR 0037. Home and other weekly-read callers use this; the Engine push uses the event
/// receipt (`CoachMessageSnapshot`), not this card.
struct CoachReadCard: View {
    let read: CoachReadSnapshot

    var body: some View {
        WarmCard(fill: WarmInstrument.surfaceMuted) {
            VStack(alignment: .leading, spacing: 10) {
                MonoLabel("\(read.eyebrow ?? "COACH'S READ") · \(read.dateLabel)")
                Text(read.body)
                    .font(.system(size: 15, design: .serif).italic())
                    .foregroundColor(WarmInstrument.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(read.signature ?? "— PHELPS")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
        }
    }
}
