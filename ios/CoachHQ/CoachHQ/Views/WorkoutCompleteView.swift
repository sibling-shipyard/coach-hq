import SwiftUI

struct WorkoutCompleteView: View {
    let workout: Workout
    let elapsed: Int
    let onDismiss: () -> Void

    private var accent: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        ZStack {
            accent.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    completeBadge
                        .staggerReveal(delay: 0.15, offset: 10)
                        .padding(.top, 52)

                    titleBlock
                        .staggerReveal(delay: 0.25, offset: 10)
                        .padding(.top, 20)

                    timeTrophy
                        .staggerReveal(delay: 0.40, offset: 14)
                        .padding(.top, 28)

                    statsRow
                        .staggerReveal(delay: 0.55, offset: 10)
                        .padding(.top, 22)

                    if !workout.coachingNote.isEmpty {
                        coachNoteCard
                            .staggerReveal(delay: 0.68, offset: 10)
                            .padding(.top, 20)
                    }

                    ctaButtons
                        .staggerReveal(delay: 0.78, offset: 10)
                        .padding(.top, 36)
                        .padding(.bottom, 48)
                }
                .padding(.horizontal, 28)
            }
        }
        .onAppear {
            playCompletionHaptics()
        }
    }

    // MARK: - Sections

    private var completeBadge: some View {
        Text("WORKOUT COMPLETE")
            .font(WarmInstrument.monoLabel(10))
            .kerning(1.4)
            .foregroundColor(accent)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(Color.white.opacity(0.95))
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private var titleBlock: some View {
        VStack(spacing: 7) {
            Text(workout.title)
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
            Text("\(Theme.workoutLabel(for: workout.workoutType)) · \(workout.subtitle.uppercased())")
                .font(WarmInstrument.figures(11))
                .foregroundColor(Color.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
    }

    private var timeTrophy: some View {
        VStack(spacing: 4) {
            Text(WorkoutTimerWarm.formatTimer(elapsed))
                .font(WarmInstrument.figures(80, weight: .bold))
                .foregroundColor(.white)
                .monospacedDigit()
            Text("TOTAL TIME")
                .font(WarmInstrument.monoLabel(10))
                .kerning(1.4)
                .foregroundColor(Color.white.opacity(0.5))
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
                .foregroundColor(.white)
            Text(label)
                .font(WarmInstrument.monoLabel(9))
                .kerning(1)
                .foregroundColor(Color.white.opacity(0.5))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(Color.white.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(0.2), lineWidth: 1)
        )
    }

    private var coachNoteCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(workout.coachingNote)
                .font(WarmInstrument.coachVoice(16))
                .foregroundColor(Color.white.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(3)
            Text("— Coach Phelps")
                .font(WarmInstrument.monoLabel(9))
                .tracking(1.2)
                .foregroundColor(Color.white.opacity(0.45))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color.white.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
        )
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
                .foregroundColor(accent)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Color.white)
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
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(Color.white.opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.28), lineWidth: 1)
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
