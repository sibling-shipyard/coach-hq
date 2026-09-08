import SwiftUI

/// In-app proactive Coach message teaser — taps through to Coach chat. Moved here in W3b of
/// docs/plans/ios-widget-modules.md (already correctly named per ADR 0037's `…Card` convention).
struct CoachMessageCard: View {
    let message: CoachMessageSnapshot
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            WarmCard(fill: WarmInstrument.surfaceMuted) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        MonoLabel("COACH", size: 10)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(WarmInstrument.inkFaint)
                    }
                    Text(message.body)
                        .font(.system(size: 15, design: .serif).italic())
                        .foregroundColor(WarmInstrument.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    MonoLabel("OPEN WITH COACH", size: 8, color: WarmInstrument.inkMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
        }
        .buttonStyle(CardPressButtonStyle())
        .accessibilityLabel("Coach. \(message.body)")
        .accessibilityHint("Opens this message in Coach chat")
    }
}
