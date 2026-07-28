import SwiftUI

struct WorkoutOverviewView: View {
    let workout: Workout
    @Environment(\.dismiss) private var dismiss
    @State private var showTimer = false

    private var accent: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    metaSection
                    coachingNote
                    equipmentSection
                    phaseBlocks
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 100)
            }

            startBar
        }
        .background(Theme.mutedBackground)
        .toolbar(.hidden, for: .navigationBar)
        .simultaneousGesture(edgeBackSwipeGesture)
        .fullScreenCover(isPresented: $showTimer) {
            WorkoutTimerView(workout: workout, onExitToList: {
                showTimer = false
                dismiss()
            })
        }
    }

    /// Swipe right from the leading edge to pop back to the workouts list.
    private var edgeBackSwipeGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onEnded { value in
                guard value.startLocation.x < 28,
                      value.translation.width > 56,
                      abs(value.translation.height) < 96 else { return }
                Haptics.tap()
                dismiss()
            }
    }

    private var metaSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                Button {
                    Haptics.tap()
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(WarmInstrument.inkMuted)
                }
                .buttonStyle(.plain)

                Text(workout.title)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(Theme.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            WarmWorkoutTypeBadge(
                label: Theme.workoutLabel(for: workout.workoutType),
                accent: accent
            )
            Text(workout.subtitle)
                .font(.system(size: 14))
                .foregroundColor(WarmInstrument.inkMuted)
            HStack(spacing: 16) {
                Text("\(workout.estimatedDurationMins)M")
                Text("\(workout.exerciseCount) EXERCISES")
                Text("\(workout.setCount) SETS")
            }
            .font(WarmInstrument.figures(11))
            .foregroundColor(WarmInstrument.inkFaint)
        }
    }

    private var coachingNote: some View {
        Text(workout.coachingNote)
            .font(WarmInstrument.coachVoice(14.5))
            .foregroundColor(Color(red: 0x4A / 255, green: 0x4C / 255, blue: 0x45 / 255))
            .padding(.leading, 14)
            .overlay(alignment: .leading) {
                Rectangle().fill(accent).frame(width: 2)
            }
    }

    @ViewBuilder
    private var equipmentSection: some View {
        if !workout.equipment.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("EQUIPMENT")
                    .font(WarmInstrument.monoLabel(9))
                    .kerning(1.4)
                    .foregroundColor(WarmInstrument.inkFaint)
                Text(workout.equipment.joined(separator: " · "))
                    .font(WarmInstrument.figures(12.5, weight: .regular))
                    .foregroundColor(Color(red: 0x4A / 255, green: 0x4C / 255, blue: 0x45 / 255))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(WarmInstrument.paper)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(WarmInstrument.border, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private var phaseBlocks: some View {
        VStack(spacing: 14) {
            ForEach(workout.phases) { phase in
                WarmPhaseBlock(phase: phase)
            }
        }
    }

    private var startBar: some View {
        VStack(spacing: 0) {
            Rectangle().fill(WarmInstrument.headerRule).frame(height: 1)
            WarmPrimaryCTA(title: "▶ Start workout") {
                Haptics.tap()
                showTimer = true
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(WarmInstrument.paper)
        }
    }
}

// MARK: - Phase block (mock 3b)

private struct WarmPhaseBlock: View {
    let phase: WorkoutPhase

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                HStack(spacing: 8) {
                    Text(phase.name.uppercased())
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Theme.ink)
                    if phase.isCircuit {
                        Text("↻ \(phase.roundCount)×")
                            .font(WarmInstrument.figures(11))
                            .foregroundColor(WorkoutTimerWarm.rust)
                    }
                }
                Spacer()
                Text(phase.duration.uppercased())
                    .font(WarmInstrument.figures(10))
                    .foregroundColor(WarmInstrument.inkFaint)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(WarmInstrument.surfaceMuted)

            ForEach(phase.exercises) { ex in
                HStack(alignment: .top, spacing: 14) {
                    Text("\(ex.num)")
                        .font(WarmInstrument.figures(11))
                        .foregroundColor(Color(red: 0xC2 / 255, green: 0xBC / 255, blue: 0xAE / 255))
                        .frame(width: 14, alignment: .trailing)
                        .padding(.top, 2)

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            Text(ex.name)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(Theme.ink)
                            if ex.isOptional {
                                Text("OPTIONAL")
                                    .font(WarmInstrument.monoLabel(8))
                                    .kerning(1)
                                    .foregroundColor(Color(red: 0xA8 / 255, green: 0x9F / 255, blue: 0x8C / 255))
                            }
                        }
                        Text(ex.formCue)
                            .font(.system(size: 12))
                            .foregroundColor(WarmInstrument.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 0)

                    Text(WorkoutTimerWarm.doseFor(ex))
                        .font(WarmInstrument.figures(12))
                        .foregroundColor(Color(red: 0x4A / 255, green: 0x4C / 255, blue: 0x45 / 255))
                        .padding(.top, 2)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) {
                    if ex.num != phase.exercises.last?.num {
                        Rectangle()
                            .fill(Color(red: 0xEF / 255, green: 0xE9 / 255, blue: 0xDC / 255))
                            .frame(height: 1)
                    }
                }
            }
        }
        .background(WarmInstrument.paper)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(WarmInstrument.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
