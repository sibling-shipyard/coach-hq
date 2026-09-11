import SwiftUI

/// In-app "Coach's read" card — date-stamped commentary + signature. Moved here in W3b of
/// docs/plans/ios-widget-modules.md, renamed from `CoachReadWidget` to match the `…Card`
/// convention (ADR 0037). Was dead only because `EngineDetailView` redrew its own bespoke
/// version instead of calling this one; that view now calls this card instead (see its
/// `coachReadCard` property), which is the adoption this stack's plan calls for.
///
/// **Visible change where it lands:** `EngineDetailView`'s Coach's Read card gains the date
/// label and signature line this version always showed, and switches off its own
/// `coachVoice(16.5)` font onto this card's italic serif — the two had drifted since one was
/// live and the other wasn't maintained.
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
