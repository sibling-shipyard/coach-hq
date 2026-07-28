import SwiftUI
import AVFoundation

// MARK: - WorkoutTimerView (container)

struct WorkoutTimerView: View {
    let workout: Workout
    @Environment(\.dismiss) private var dismiss
    @StateObject private var engine: WorkoutTimerEngine

    init(workout: Workout) {
        self.workout = workout
        _engine = StateObject(wrappedValue: WorkoutTimerEngine(
            workout: workout,
            beepPlayer: BeepPlayer()
        ))
    }

    private var accentColor: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        Group {
            if engine.state == .complete {
                WorkoutCompleteView(
                    workout: workout,
                    elapsed: engine.totalElapsed,
                    onDismiss: { dismiss() }
                )
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .move(edge: .bottom)),
                    removal: .opacity
                ))
            } else {
                activeTimer
                    .transition(.opacity)
            }
        }
        .animation(.spring(duration: 0.5, bounce: 0.05), value: engine.state == .complete)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            engine.start()
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            engine.cleanup()
        }
        // Auto-pause on phone calls / audio interruptions
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { n in
            guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:  if !engine.isPaused { engine.togglePause() }
            case .ended:  if  engine.isPaused { engine.togglePause() }
            @unknown default: break
            }
        }
    }

    // MARK: - Active timer layout

    private var activeTimer: some View {
        VStack(spacing: 0) {
            TimerHeaderView(engine: engine, accentColor: accentColor, onClose: { dismiss() })

            // Progress bar — spring so it eases into position rather than sliding linearly
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Color(uiColor: .systemFill)
                    accentColor
                        .frame(width: geo.size.width * engine.progressPct)
                        .animation(.spring(duration: 0.5, bounce: 0), value: engine.progressPct)
                }
            }
            .frame(height: 3)

            // Main content — fades + slides up when state changes
            ScrollView {
                TimerScreenView(engine: engine, accentColor: accentColor)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 28)
                    .frame(maxWidth: .infinity)
                    .id(engine.state)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .offset(y: 10)),
                        removal: .opacity
                    ))
            }
            .animation(.spring(duration: 0.35, bounce: 0.05), value: engine.state)

            TimerControlsView(engine: engine, accentColor: accentColor)
        }
        .background(Color(uiColor: .systemBackground))
    }
}

// MARK: - Header

private struct TimerHeaderView: View {
    @ObservedObject var engine: WorkoutTimerEngine
    let accentColor: Color
    let onClose: () -> Void

    private var phaseLabel: String {
        switch engine.state {
        case .phaseTransition: return "NEXT PHASE"
        case .prep:            return "GET READY"
        case .rest:            return "REST"
        default:               return engine.phase?.name.uppercased() ?? ""
        }
    }

    var body: some View {
        HStack {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.secondary)
                    .padding(10)
            }

            Spacer()

            // Phase label crossfades when state changes
            Text(phaseLabel)
                .font(.system(size: 11, weight: .bold))
                .kerning(1.5)
                .foregroundColor(.secondary)
                .lineLimit(1)
                .id(phaseLabel)
                .transition(.opacity)

            Spacer()

            Button {
                engine.isMuted.toggle()
                Haptics.tap()
            } label: {
                Image(systemName: engine.isMuted ? "speaker.slash" : "speaker.wave.2")
                    .font(.system(size: 16))
                    .foregroundColor(engine.isMuted ? .secondary : accentColor)
                    .padding(10)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 4)
        // Provides the animation context for the label's .transition(.opacity)
        .animation(.easeOut(duration: 0.2), value: engine.state)
    }
}

// MARK: - Screen (state-driven content)

private struct TimerScreenView: View {
    @ObservedObject var engine: WorkoutTimerEngine
    let accentColor: Color

    // Drives the countdown pulse on final 3 seconds
    @State private var isPulsing = false

    var body: some View {
        switch engine.state {
        case .phaseTransition: phaseTransitionScreen
        case .prep:            prepScreen
        case .rest:            restScreen
        case .exercise:        exerciseScreen
        case .complete:        EmptyView()
        }
    }

    // MARK: Phase transition

    private var phaseTransitionScreen: some View {
        VStack(spacing: 20) {
            Text("NEXT PHASE")
                .font(.system(size: 11, weight: .bold)).kerning(2)
                .foregroundColor(.blue)

            Text(engine.phase?.name ?? "")
                .font(.system(size: 24, weight: .bold))
                .multilineTextAlignment(.center)

            timerDisplay(color: .blue)

            if let first = engine.phase?.exercises.first {
                infoCard(label: "First Up", content: first.name)
            }

            if engine.phase?.isOptional == true {
                skipPhaseButton
            }
        }
    }

    // MARK: Prep

    private var prepScreen: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("GET READY")
                .font(.system(size: 11, weight: .bold)).kerning(2)
                .foregroundColor(Theme.attentionOrange)
                .frame(maxWidth: .infinity, alignment: .center)

            if let ex = engine.exercise {
                Text(ex.name)
                    .font(.system(size: 26, weight: .bold))

                setLine(for: ex)

                timerDisplay(color: Theme.attentionOrange)

                infoCard(label: "Form Cue", content: ex.formCue)
            }
        }
    }

    // MARK: Rest

    private var restScreen: some View {
        VStack(spacing: 20) {
            Text(engine.isCircuit ? "REST · ROUND \(engine.pos.roundNum)/\(engine.phaseRounds)" : "REST")
                .font(.system(size: 11, weight: .bold)).kerning(2)
                .foregroundColor(.secondary)

            timerDisplay(color: Theme.accentGreen)

            if let preview = engine.nextPreview {
                infoCard(label: preview.label.uppercased(), content: preview.name)
            }
        }
    }

    // MARK: Exercise

    private var exerciseScreen: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let ex = engine.exercise {
                // Exercise name + optional badge
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(ex.name)
                            .font(.system(size: 26, weight: .bold))
                            .fixedSize(horizontal: false, vertical: true)
                        setLine(for: ex)
                    }
                    if ex.isOptional {
                        Text("OPTIONAL")
                            .font(.system(size: 9, weight: .bold)).kerning(1)
                            .foregroundColor(Theme.attentionOrange)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .overlay(
                                RoundedRectangle(cornerRadius: 3)
                                    .stroke(Theme.attentionOrange.opacity(0.5), lineWidth: 1)
                            )
                            .padding(.top, 4)
                    }
                }

                // Both-sides indicator — springs when side flips
                if ex.isBothSides && ex.type == .timed {
                    bothSidesIndicator
                        .animation(.spring(duration: 0.3, bounce: 0.2), value: engine.sideNum)
                }

                // Timer / reps display
                if ex.type == .timed {
                    timerDisplay(color: accentColor)
                } else {
                    repsDisplay(reps: ex.reps ?? 0)
                }

                infoCard(label: "Form Cue", content: ex.formCue)
                infoCard(label: "Why", content: ex.why)
            }
        }
    }

    // MARK: - Shared sub-views

    private func timerDisplay(color: Color) -> some View {
        Text(formattedTimer(engine.timerValue ?? 0))
            .font(.system(size: 76, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundColor(color)
            .frame(maxWidth: .infinity, alignment: .center)
            // Roll downward — correct direction for a countdown
            .contentTransition(.numericText(countsDown: true))
            .animation(.spring(duration: 0.2, bounce: 0), value: engine.timerValue)
            // Scale pulse on final 3 seconds to amplify the audio beep
            .scaleEffect(isPulsing ? 1.07 : 1.0)
            .animation(.spring(duration: 0.3, bounce: 0.5), value: isPulsing)
            .onChange(of: engine.timerValue) { val in
                guard let v = val, v <= 3, v > 0 else { return }
                isPulsing = true
                Task {
                    try? await Task.sleep(nanoseconds: 120_000_000)
                    isPulsing = false
                }
            }
    }

    private func repsDisplay(reps: Int) -> some View {
        VStack(spacing: 4) {
            Text("\(reps)")
                .font(.system(size: 76, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(accentColor)
                .frame(maxWidth: .infinity, alignment: .center)
            Text(reps == 1 ? "REP" : "REPS")
                .font(.system(size: 11, weight: .bold)).kerning(2)
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private func setLine(for ex: WorkoutExercise) -> some View {
        Text(engine.isCircuit
             ? "Round \(engine.pos.roundNum) of \(engine.phaseRounds)"
             : "Set \(engine.pos.setNum) of \(ex.sets)")
            .font(.system(size: 14).monospacedDigit())
            .foregroundColor(.secondary)
    }

    private var bothSidesIndicator: some View {
        HStack(spacing: 12) {
            sideChip("LEFT",  active: engine.sideNum == 0)
            Image(systemName: "arrow.right")
                .font(.system(size: 12))
                .foregroundColor(.secondary)
            sideChip("RIGHT", active: engine.sideNum == 1)
        }
    }

    private func sideChip(_ label: String, active: Bool) -> some View {
        Text(label)
            .font(.system(size: 11, weight: .bold)).kerning(1)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(active ? Color.primary : Color.clear)
            .foregroundColor(active ? Color(uiColor: .systemBackground) : .secondary)
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(active ? Color.primary : Theme.cardBorder, lineWidth: 1.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    private func infoCard(label: String, content: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.system(size: 10, weight: .bold)).kerning(1.5)
                .foregroundColor(.secondary)
            Text(content)
                .font(.system(size: 13))
                .foregroundColor(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.mutedBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var skipPhaseButton: some View {
        Button {
            engine.handleSkipPhase()
            Haptics.tap()
        } label: {
            Label("Skip Phase", systemImage: "forward.end")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Theme.attentionOrange)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.top, 4)
    }

    private func formattedTimer(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

// MARK: - Controls bar

private struct TimerControlsView: View {
    @ObservedObject var engine: WorkoutTimerEngine
    let accentColor: Color

    private var isPhaseTransition: Bool { engine.state == .phaseTransition }
    private var isPrep: Bool            { engine.state == .prep }
    private var isRest: Bool            { engine.state == .rest }
    private var isReps: Bool            { engine.state == .exercise && engine.exercise?.type == .reps }
    private var isOptionalEx: Bool      { engine.exercise?.isOptional == true }
    private var isOptionalPhase: Bool   { engine.phase?.isOptional == true }

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 16) {
                // Back
                controlButton(icon: "backward.end") {
                    engine.handleGoBack()
                    Haptics.tap()
                }

                // Main action
                mainActionButton

                // Forward / optional skip
                if isOptionalEx {
                    controlButton(icon: "forward.end", tint: Theme.attentionOrange) {
                        engine.handleSkipOptional()
                        Haptics.tap()
                    }
                } else if isOptionalPhase && (engine.state == .exercise || isRest || isPrep) {
                    controlButton(icon: "forward.end", tint: Theme.attentionOrange) {
                        engine.handleSkipPhase()
                        Haptics.tap()
                    }
                } else {
                    controlButton(icon: "forward.end") {
                        engine.handleSkip()
                        Haptics.tap()
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
        }
        .background(Color(uiColor: .systemBackground))
    }

    @ViewBuilder
    private var mainActionButton: some View {
        if isPhaseTransition || isPrep {
            primaryButton(label: "Skip", icon: "chevron.right") {
                engine.handleSkip()
                Haptics.tap()
            }
        } else if isRest {
            primaryButton(label: "Skip Rest", icon: "chevron.right") {
                engine.handleSkip()
                Haptics.tap()
            }
        } else if isReps {
            // Large Done button — medium impact since this is completing a set
            Button {
                engine.handleExerciseDone()
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 16, weight: .bold))
                    Text("DONE")
                        .font(.system(size: 17, weight: .bold))
                        .kerning(1)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
                .background(accentColor)
                .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
            }
            .buttonStyle(ScaleButtonStyle())
        } else {
            // Timed exercise: pause/resume
            primaryButton(
                label: engine.isPaused ? "Resume" : "Pause",
                icon: engine.isPaused ? "play.fill" : "pause.fill"
            ) {
                engine.togglePause()
                Haptics.tap()
            }
        }
    }

    private func primaryButton(label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                Text(label)
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(Color.primary)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius))
        }
        .buttonStyle(ScaleButtonStyle())
    }

    private func controlButton(icon: String, tint: Color = Color(uiColor: .secondaryLabel), action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .medium))
                .foregroundColor(tint)
                .frame(width: 50, height: 50)
                .background(Theme.mutedBackground)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(ScaleButtonStyle(scale: 0.90))
    }
}

// MARK: - Scale press feedback (DESIGN.md: instant press response, no list edge clipping)

private struct ScaleButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.95

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1.0)
            .animation(.spring(duration: 0.15, bounce: 0), value: configuration.isPressed)
    }
}
