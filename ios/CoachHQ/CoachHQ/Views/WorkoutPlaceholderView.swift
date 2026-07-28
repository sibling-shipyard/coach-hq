import SwiftUI

/// Placeholder for the v0.2 native workout timer.
struct WorkoutPlaceholderView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                BrandHeader(title: "Timer")

                Spacer()

                VStack(spacing: 14) {
                    Image(systemName: "timer")
                        .font(.system(size: 44))
                        .foregroundColor(Theme.accentGreen)

                    Text("Workout Timer")
                        .font(.system(size: 17, weight: .semibold, design: .rounded))

                    Text("Coming soon")
                        .font(.footnote)
                        .foregroundColor(.secondary)

                    Text("Will read today's session from your repo\nand run the full timer with audio cues.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Spacer()
            }
            .background(Color(uiColor: .systemBackground))
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}
