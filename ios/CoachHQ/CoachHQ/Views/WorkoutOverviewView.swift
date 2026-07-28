import SwiftUI

struct WorkoutOverviewView: View {
    let workout: Workout
    @State private var showTimer = false

    private var color: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {

                // Meta
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(Theme.workoutLabel(for: workout.workoutType))
                            .font(.system(size: 9, weight: .bold)).kerning(1)
                            .foregroundColor(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(color)
                        if workout.isCoachAdjusted, let date = workout.sessionDate {
                            Text(date)
                                .font(.system(size: 9, weight: .bold)).kerning(1)
                                .foregroundColor(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Theme.accentGreen)
                        }
                    }

                    Text(workout.subtitle)
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)

                    HStack(spacing: 16) {
                        Label("\(workout.estimatedDurationMins) min", systemImage: "clock")
                        Label("\(workout.exerciseCount) exercises · \(workout.setCount) sets", systemImage: "dumbbell")
                    }
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                }

                // Coaching note
                Text(workout.coachingNote)
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
                    .italic()
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(color).frame(width: 2)
                    }

                // Equipment
                if !workout.equipment.isEmpty {
                    ThemedCard {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionHeader("Equipment")
                            Text(workout.equipment.joined(separator: " · "))
                                .font(.system(size: 13, weight: .medium))
                                .foregroundColor(.primary)
                        }
                    }
                }

                // Coach note (for session adjustments)
                if let note = workout.phases.first(where: { $0.coachingNote != nil })?.coachingNote {
                    ThemedCard {
                        VStack(alignment: .leading, spacing: 6) {
                            SectionHeader("Session Note")
                            Text(note)
                                .font(.system(size: 13))
                                .foregroundColor(.secondary)
                        }
                    }
                }

                // Phase list
                VStack(spacing: 10) {
                    ForEach(workout.phases) { phase in
                        PhasePreviewRow(phase: phase, workoutColor: color)
                    }
                }

                // Start button
                Button {
                    Haptics.tap()
                    showTimer = true
                } label: {
                    Text("Start Workout")
                }
                .buttonStyle(PrimaryButtonStyle(fill: color))
                .padding(.top, 4)
                .padding(.bottom, 8)
            }
            .padding(16)
        }
        .navigationTitle(workout.title)
        .navigationBarTitleDisplayMode(.large)
        .background(Color(uiColor: .systemBackground))
        .fullScreenCover(isPresented: $showTimer) {
            WorkoutTimerView(workout: workout)
        }
    }
}

// MARK: - Phase preview row

private struct PhasePreviewRow: View {
    let phase: WorkoutPhase
    let workoutColor: Color

    var body: some View {
        ThemedCard(padding: 0) {
            VStack(spacing: 0) {
                // Phase header
                HStack {
                    HStack(spacing: 6) {
                        Text(phase.name.uppercased())
                            .font(.system(size: 11, weight: .bold))
                            .kerning(0.5)
                        if phase.isCircuit {
                            HStack(spacing: 2) {
                                Image(systemName: "repeat")
                                    .font(.system(size: 10))
                                Text("\(phase.roundCount)×")
                                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                            }
                            .foregroundColor(.secondary)
                        }
                        if phase.isOptional {
                            Text("OPTIONAL")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(Theme.attentionOrange)
                        }
                    }
                    Spacer()
                    Text(phase.duration)
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.mutedBackground)

                Divider()

                // Exercise rows
                ForEach(phase.exercises) { ex in
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(ex.num)")
                            .font(.system(size: 11).monospacedDigit())
                            .foregroundColor(.secondary)
                            .frame(width: 20, alignment: .trailing)

                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 6) {
                                Text(ex.name)
                                    .font(.system(size: 13, weight: .medium))
                                if ex.isOptional {
                                    Text("optional")
                                        .font(.system(size: 10))
                                        .foregroundColor(Color(uiColor: .tertiaryLabel))
                                }
                            }
                            Text(ex.formCue)
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }

                        Spacer()

                        Text(ex.type == .timed
                             ? "\(ex.sets)×\(ex.durationSecs ?? 0)s"
                             : "\(ex.sets)×\(ex.reps ?? 0)")
                            .font(.system(size: 11).monospacedDigit())
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)

                    if ex.num != phase.exercises.last?.num {
                        Divider().padding(.leading, 44)
                    }
                }
            }
        }
    }
}
