import SwiftUI

struct WorkoutCompleteView: View {
    let workout: Workout
    let elapsed: Int
    let onDismiss: () -> Void

    private var accent: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                completeBadge
                    .staggerReveal(delay: 0.15, offset: 10)
                    .padding(.top, 52)

                titleBlock
                    .staggerReveal(delay: 0.25, offset: 10)
                    .padding(.top, 20)

                summaryCard
                    .staggerReveal(delay: 0.40, offset: 14)
                    .padding(.top, 28)

                if !workout.coachingNote.isEmpty {
                    coachNoteCard
                        .staggerReveal(delay: 0.68, offset: 10)
                        .padding(.top, 20)
                }

                ctaButtons
                    .staggerReveal(delay: 0.78, offset: 10)
                    .padding(.top, 32)
                    .padding(.bottom, 48)
            }
            .padding(.horizontal, 24)
        }
        .background(WarmInstrument.desk.ignoresSafeArea())
        .onAppear {
            playCompletionHaptics()
        }
    }

    // MARK: - Sections

    private var completeBadge: some View {
        Text("WORKOUT COMPLETE")
            .font(WarmInstrument.monoLabel(10))
            .kerning(1.4)
            .foregroundColor(WarmInstrument.onAccent)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(accent)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private var titleBlock: some View {
        VStack(spacing: 7) {
            Text(workout.title)
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(Theme.ink)
                .multilineTextAlignment(.center)
            Text("\(Theme.workoutLabel(for: workout.workoutType)) · \(workout.subtitle.uppercased())")
                .font(WarmInstrument.figures(11))
                .foregroundColor(WarmInstrument.inkMuted)
                .multilineTextAlignment(.center)
        }
    }

    private var summaryCard: some View {
        WarmCard(padding: 0) {
            VStack(spacing: 0) {
                timeTrophy
                    .padding(.top, 20)
                    .padding(.bottom, 18)

                WarmInstrument.border
                    .frame(height: 1)

                statsRow
                    .padding(.vertical, 14)
            }
        }
    }

    private var timeTrophy: some View {
        VStack(spacing: 4) {
            Text(WorkoutTimerWarm.formatTimer(elapsed))
                .font(WarmInstrument.figures(72, weight: .bold))
                .foregroundColor(accent)
                .monospacedDigit()
            Text("TOTAL TIME")
                .font(WarmInstrument.monoLabel(10))
                .kerning(1.4)
                .foregroundColor(WarmInstrument.inkFaint)
        }
    }

    private var statsRow: some View {
        HStack(spacing: 10) {
            statCard(value: "\(workout.exerciseCount)", label: "EXERCISES")
            statCard(value: "\(workout.setCount)", label: "SETS")
            statCard(value: "\(workout.phases.count)", label: "BLOCKS")
        }
    }

    private func statCard(value: String, label: String) -> some View {
        VStack(spacing: 5) {
            Text(value)
                .font(WarmInstrument.figures(24, weight: .bold))
                .foregroundColor(Theme.ink)
            Text(label)
                .font(WarmInstrument.monoLabel(9))
                .kerning(1)
                .foregroundColor(WarmInstrument.inkFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(WarmInstrument.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(WarmInstrument.border, lineWidth: 1)
        )
    }

    private var coachNoteCard: some View {
        WarmCard {
            VStack(alignment: .leading, spacing: 10) {
                Text(workout.coachingNote)
                    .font(WarmInstrument.coachVoice(16))
                    .foregroundColor(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineSpacing(3)
                Text("— Coach Phelps")
                    .font(WarmInstrument.monoLabel(9))
                    .tracking(1.2)
                    .foregroundColor(WarmInstrument.inkFaint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var ctaButtons: some View {
        VStack(spacing: 12) {
            Button {
                NotificationCenter.default.post(name: .navigateToChat, object: nil)
                Haptics.tap()
                onDismiss()
            } label: {
                HStack(spacing: 8) {
                    Text("Talk to Coach")
                        .font(.system(size: 15, weight: .bold))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 13, weight: .bold))
                }
                .foregroundColor(WarmInstrument.onAccent)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(accent)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(CompletePressStyle())

            Button {
                NotificationCenter.default.post(name: .navigateToHome, object: nil)
                Haptics.tap()
                onDismiss()
            } label: {
                Text("Back to Home")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Theme.ink)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(WarmInstrument.paper)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(WarmInstrument.border, lineWidth: 1)
                    )
            }
            .buttonStyle(CompletePressStyle())
        }
    }

    // MARK: - Haptics

    private func playCompletionHaptics() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) {
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        }
    }
}

private struct CompletePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.18, bounce: 0), value: configuration.isPressed)
    }
}
