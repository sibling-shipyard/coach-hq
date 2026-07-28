import SwiftUI

/// Shared empty state for the S-size home screen widgets — per the Design Philosophy's "data
/// states are always live" rule, a widget with no App Group snapshot yet (fresh install, app
/// never opened, App Group misconfigured) collapses to this instead of ever inventing a number.
struct EmptyGlanceView: View {
    let label: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .tracking(1.0)
                .foregroundColor(WarmInstrument.inkFaint)
            Spacer()
            Text(message)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(WarmInstrument.inkMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
