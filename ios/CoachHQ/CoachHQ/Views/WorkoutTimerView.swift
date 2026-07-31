import SwiftUI
import AVFoundation

// MARK: - WorkoutTimerView (Warm Instrument live follow-along — mock 1b)

struct WorkoutTimerView: View {
    let workout: Workout
    var onExitToList: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @StateObject private var engine: WorkoutTimerEngine
    @State private var showQuitConfirm = false
    @State private var showExerciseList = false

    init(workout: Workout, onExitToList: (() -> Void)? = nil) {
        self.workout = workout
        self.onExitToList = onExitToList
        _engine = StateObject(wrappedValue: WorkoutTimerEngine(
            workout: workout,
            beepPlayer: BeepPlayer()
        ))
    }

    private var accent: Color { Theme.workoutColor(for: workout.workoutType) }

    var body: some View {
        Group {
            if engine.state == .complete {
                WorkoutCompleteView(
                    workout: workout,
                    elapsed: engine.totalElapsed,
                    onDismiss: exitWorkout
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
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { n in
            guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            switch type {
            case .began:  if !engine.isPaused { engine.togglePause() }
            case .ended:  if  engine.isPaused { engine.togglePause() }
            @unknown default: break
            }
        }
        .overlay {
            if showQuitConfirm {
                WarmQuitDialog(
                    onContinue: { showQuitConfirm = false },
                    onQuit: exitWorkout
                )
                .transition(.opacity)
            }
        }
        .animation(.spring(duration: 0.25, bounce: 0), value: showQuitConfirm)
        .sheet(isPresented: $showExerciseList) {
            WarmWorkoutExerciseListSheet(
                workout: workout,
                engine: engine,
                accent: accent
            )
        }
    }

    private func exitWorkout() {
        if let onExitToList {
            onExitToList()
        } else {
            dismiss()
        }
    }

    // MARK: - Active layout

    private var activeTimer: some View {
        VStack(spacing: 0) {
            timerHeader

            ScrollView {
                WarmTimerFocusBody(engine: engine, workout: workout, accent: accent)
                    .padding(.horizontal, 22)
                    .padding(.top, 14)
                    .padding(.bottom, 12)
                    .id(engine.state)
            }

            WarmTimerControls(
                primaryLabel: primaryLabel,
                onPrev: {
                    engine.handleGoBack()
                    Haptics.tap()
                },
                onPrimary: handlePrimary,
                onNext: {
                    handleForward()
                    Haptics.tap()
                }
            )
        }
        .background(WarmInstrument.paper)
    }

    private var timerHeader: some View {
        HStack(spacing: 10) {
            Button { showQuitConfirm = true } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(WarmInstrument.inkMuted)
            }
            .buttonStyle(.plain)

            Text(workout.title)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(Theme.ink)
                .lineLimit(1)

            Spacer(minLength: 0)

            Button {
                showExerciseList = true
                Haptics.tap()
            } label: {
                Image(systemName: "list.bullet")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(WarmInstrument.inkMuted)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)

            WarmTimerHeaderRight(
                muted: engine.isMuted,
                elapsed: engine.totalElapsed,
                onToggleMute: {
                    engine.isMuted.toggle()
                    Haptics.tap()
                }
            )
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(WarmInstrument.paper)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(WarmInstrument.headerRule)
                .frame(height: 1)
        }
    }

    private var primaryLabel: String {
        switch engine.state {
        case .phaseTransition, .prep:
            return "Skip"
        case .rest:
            return "Skip Rest"
        case .exercise:
            if engine.exercise?.type == .reps { return "Done" }
            return engine.isPaused ? "Resume" : "Pause"
        case .complete:
            return ""
        }
    }

    private func handlePrimary() {
        switch engine.state {
        case .phaseTransition, .prep, .rest:
            engine.handleSkip()
        case .exercise:
            if engine.exercise?.type == .reps {
                engine.handleExerciseDone()
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            } else {
                engine.togglePause()
            }
        case .complete:
            break
        }
        Haptics.tap()
    }

    private func handleForward() {
        if engine.exercise?.isOptional == true {
            engine.handleSkipOptional()
        } else if engine.phase?.isOptional == true,
                  engine.state == .exercise || engine.state == .rest || engine.state == .prep {
            engine.handleSkipPhase()
        } else {
            engine.handleSkip()
        }
    }
}

// MARK: - Focus body (mock 1b content column)

private struct WarmTimerFocusBody: View {
    @ObservedObject var engine: WorkoutTimerEngine
    let workout: Workout
    let accent: Color

    @State private var isPulsing = false

    private var phase: WorkoutPhase? { engine.phase }
    private var exercise: WorkoutExercise? { engine.exercise }

    private var exOfBlock: String {
        guard let phase else { return "" }
        return "\(engine.pos.exerciseIdx + 1)/\(phase.exercises.count)"
    }

    private var setLabel: String {
        guard let exercise else { return "" }
        if engine.isCircuit {
            return "Round \(engine.pos.roundNum) of \(engine.phaseRounds)"
        }
        return "Set \(engine.pos.setNum) of \(exercise.sets)"
    }

    private var displayName: String {
        switch engine.state {
        case .rest: return "Rest"
        case .phaseTransition: return phase?.name ?? "Up next"
        default: return exercise?.name ?? ""
        }
    }

    private var readoutColor: Color {
        if engine.state == .exercise, exercise?.type == .reps {
            return Theme.ink
        }
        return WorkoutTimerWarm.readoutColor(for: engine.state)
    }

    private var upNext: (label: String, name: String, dose: String)? {
        engine.nextPreview
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            blockRow
            exerciseMeta
            readoutSection
            cueSection
            if let next = upNext, engine.state != .complete {
                WarmNextStrip(label: next.label, name: next.name, dose: next.dose)
            }
        }
    }

    private var blockRow: some View {
        HStack(spacing: 8) {
            if let phase {
                Text(shortBlockName(phase.name))
                    .font(WarmInstrument.monoLabel(9))
                    .kerning(1)
                    .foregroundColor(WarmInstrument.paper)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(accent)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .lineLimit(1)
            }
            Text(exOfBlock)
                .font(WarmInstrument.figures(10))
                .foregroundColor(WarmInstrument.inkFaint)
            Spacer(minLength: 0)
        }
    }

    private func shortBlockName(_ name: String) -> String {
        let parts = name.split(separator: "—", maxSplits: 1)
        return String(parts.first ?? Substring(name)).trimmingCharacters(in: .whitespaces).uppercased()
    }

    private var exerciseMeta: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let exercise {
                Text("#\(exercise.num) · \(setLabel)")
                    .font(WarmInstrument.figures(10))
                    .foregroundColor(WarmInstrument.inkFaint)
            }
            HStack(alignment: .top, spacing: 8) {
                Text(displayName)
                    .font(.system(size: 26, weight: .bold))
                    .foregroundColor(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if exercise?.isOptional == true, engine.state == .exercise {
                    Text("OPTIONAL")
                        .font(WarmInstrument.monoLabel(9))
                        .kerning(0.8)
                        .foregroundColor(WarmInstrument.inkFaint)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .stroke(WarmInstrument.border, lineWidth: 1)
                        )
                        .padding(.top, 4)
                }
            }
        }
    }

    @ViewBuilder
    private var readoutSection: some View {
        if engine.state == .exercise,
           let exercise,
           exercise.isBothSides,
           exercise.type == .timed {
            WarmSidePills(sideNum: engine.sideNum)
                .animation(.spring(duration: 0.3, bounce: 0.2), value: engine.sideNum)
        }

        if engine.state == .exercise, exercise?.type == .reps, let reps = exercise?.reps {
            VStack(spacing: 12) {
                Text("×\(reps)")
                    .font(WarmInstrument.figures(76, weight: .bold))
                    .foregroundColor(readoutColor)
                    .frame(maxWidth: .infinity)
                caption
            }
            .padding(.vertical, 14)
        } else {
            VStack(spacing: 12) {
                Text(WorkoutTimerWarm.formatTimer(engine.timerValue ?? 0))
                    .font(WarmInstrument.figures(76, weight: .bold))
                    .foregroundColor(readoutColor)
                    .monospacedDigit()
                    .contentTransition(.numericText(countsDown: true))
                    .animation(.spring(duration: 0.2, bounce: 0), value: engine.timerValue)
                    .scaleEffect(isPulsing ? 1.05 : 1)
                    .animation(.spring(duration: 0.3, bounce: 0.5), value: isPulsing)
                    .onChange(of: engine.timerValue) {
                        guard let v = engine.timerValue, v <= 3, v > 0 else { return }
                        isPulsing = true
                        Task {
                            try? await Task.sleep(nanoseconds: 120_000_000)
                            isPulsing = false
                        }
                    }

                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Theme.mutedBackground)
                        Capsule()
                            .fill(readoutColor)
                            .frame(width: geo.size.width * engine.segmentProgressPct)
                            .animation(.linear(duration: 0.9), value: engine.segmentProgressPct)
                    }
                }
                .frame(height: 4)

                caption
            }
            .padding(.vertical, 14)
        }
    }

    private var caption: some View {
        Text(WorkoutTimerWarm.timerCaption(
            state: engine.state,
            exercise: exercise,
            sideNum: engine.sideNum,
            isCircuit: engine.isCircuit,
            roundNum: engine.pos.roundNum,
            phaseRounds: engine.phaseRounds,
            phaseName: phase?.name
        ))
        .font(WarmInstrument.monoLabel(9))
        .kerning(1.2)
        .foregroundColor(WarmInstrument.inkFaint)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var cueSection: some View {
        if (engine.state == .exercise || engine.state == .prep), let exercise {
            WarmFormCueCard(formCue: exercise.formCue, why: exercise.why)
        }
    }
}
