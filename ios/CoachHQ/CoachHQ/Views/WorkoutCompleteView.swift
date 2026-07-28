import SwiftUI

struct WorkoutCompleteView: View {
    let workout: Workout
    let elapsed: Int
    let onDismiss: () -> Void

    private var color: Color { Theme.workoutColor(for: workout.workoutType) }

    private var formattedTime: String {
        let m = elapsed / 60
        let s = elapsed % 60
        return String(format: "%02d:%02d", m, s)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 24) {
                // Badge
                Text(Theme.workoutLabel(for: workout.workoutType))
                    .font(.system(size: 10, weight: .bold)).kerning(1.5)
                    .foregroundColor(.white)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(color)

                // Title
                VStack(spacing: 6) {
                    Text("Workout Complete")
                        .font(.system(size: 28, weight: .bold))
                    Text(workout.title)
                        .font(.system(size: 16))
                        .foregroundColor(.secondary)
                }

                // Elapsed time
                VStack(spacing: 4) {
                    Text(formattedTime)
                        .font(.system(size: 64, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(color)
                    Text("TOTAL TIME")
                        .font(.system(size: 11, weight: .bold))
                        .kerning(2)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 8)

                // Stats row
                HStack(spacing: 32) {
                    VStack(spacing: 4) {
                        Text("\(workout.exerciseCount)")
                            .font(.system(size: 22, weight: .bold)).monospacedDigit()
                        Text("EXERCISES")
                            .font(.system(size: 10, weight: .bold)).kerning(1.5)
                            .foregroundColor(.secondary)
                    }
                    VStack(spacing: 4) {
                        Text("\(workout.setCount)")
                            .font(.system(size: 22, weight: .bold)).monospacedDigit()
                        Text("SETS")
                            .font(.system(size: 10, weight: .bold)).kerning(1.5)
                            .foregroundColor(.secondary)
                    }
                    VStack(spacing: 4) {
                        Text("\(workout.phases.count)")
                            .font(.system(size: 22, weight: .bold)).monospacedDigit()
                        Text("PHASES")
                            .font(.system(size: 10, weight: .bold)).kerning(1.5)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            .padding(.horizontal, 32)

            Spacer()

            // Done button — .tap() only; the .onAppear already fired the celebration haptic
            Button {
                Haptics.tap()
                onDismiss()
            } label: {
                Text("Done")
            }
            .buttonStyle(PrimaryButtonStyle(fill: color))
            .padding(.horizontal, 32)
            .padding(.bottom, 48)
        }
        .frame(maxWidth: .infinity)
        .background(Color(uiColor: .systemBackground))
        .onAppear { Haptics.success() }
    }
}
