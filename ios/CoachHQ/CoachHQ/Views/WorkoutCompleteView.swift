import SwiftUI

struct WorkoutCompleteView: View {
    let workout: Workout
    let elapsed: Int
    let onDismiss: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                Text("WORKOUT COMPLETE")
                    .font(WarmInstrument.monoLabel(10))
                    .kerning(1.4)
                    .foregroundColor(WarmInstrument.paper)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 5)
                    .background(WarmInstrument.sportColor(.badminton))
                    .clipShape(RoundedRectangle(cornerRadius: 7))

                VStack(spacing: 6) {
                    Text(workout.title)
                        .font(.system(size: 30, weight: .bold))
                        .foregroundColor(Theme.ink)
                        .multilineTextAlignment(.center)
                    Text("\(Theme.workoutLabel(for: workout.workoutType)) · \(workout.subtitle.uppercased())")
                        .font(WarmInstrument.figures(11))
                        .foregroundColor(WarmInstrument.inkFaint)
                        .multilineTextAlignment(.center)
                }

                VStack(spacing: 2) {
                    Text(WorkoutTimerWarm.formatTimer(elapsed))
                        .font(WarmInstrument.figures(72, weight: .bold))
                        .foregroundColor(WorkoutTimerWarm.rust)
                    Text("TOTAL TIME")
                        .font(WarmInstrument.monoLabel(10))
                        .kerning(1.4)
                        .foregroundColor(WarmInstrument.inkFaint)
                }

                HStack(spacing: 10) {
                    statCard(value: "\(workout.exerciseCount)", label: "EXERCISES")
                    statCard(value: "\(workout.setCount)", label: "SETS")
                    statCard(value: "\(workout.phases.count)", label: "BLOCKS")
                }

                if !workout.coachingNote.isEmpty {
                    Text("\(workout.coachingNote) — Coach")
                        .font(WarmInstrument.coachVoice(14.5))
                        .foregroundColor(Color(red: 0x4A / 255, green: 0x4C / 255, blue: 0x45 / 255))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 14)
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .fill(WarmInstrument.sportColor(.badminton))
                                .frame(width: 2)
                        }
                }

                WarmPrimaryCTA(title: "Back to workouts", action: {
                    Haptics.tap()
                    onDismiss()
                })
            }
            .padding(.horizontal, 40)
            .padding(.vertical, 48)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.mutedBackground)
        .onAppear { Haptics.success() }
    }

    private func statCard(value: String, label: String) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(WarmInstrument.figures(22, weight: .bold))
                .foregroundColor(Theme.ink)
            Text(label)
                .font(WarmInstrument.monoLabel(9))
                .kerning(1)
                .foregroundColor(WarmInstrument.inkFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .padding(.horizontal, 12)
        .background(WarmInstrument.paper)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(WarmInstrument.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
