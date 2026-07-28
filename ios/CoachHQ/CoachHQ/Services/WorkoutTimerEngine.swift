import Foundation
import AVFoundation
import Combine

enum TimerState: Equatable {
    case phaseTransition, prep, exercise, rest, complete
}

struct TimerPosition: Equatable {
    var phaseIdx: Int = 0
    var exerciseIdx: Int = 0
    var setNum: Int = 1    // 1-based, default mode
    var roundNum: Int = 1  // 1-based, circuit mode
}

@MainActor
final class WorkoutTimerEngine: ObservableObject {
    @Published private(set) var state: TimerState = .exercise
    @Published private(set) var pos = TimerPosition()
    @Published private(set) var timerValue: Int? = nil
    @Published private(set) var isPaused = false
    @Published private(set) var sideNum: Int = 0  // 0 = left/first, 1 = right/second
    @Published private(set) var totalElapsed: Int = 0
    @Published var isMuted = false

    let workout: Workout
    private let beepPlayer: BeepPlayer
    private var tickTask: Task<Void, Never>?
    private var elapsedTask: Task<Void, Never>?
    private var elapsedStart = Date()
    private var pauseAccumulated: TimeInterval = 0
    private var pauseStart: Date?

    var phase: WorkoutPhase?     { workout.phases[safe: pos.phaseIdx] }
    var exercise: WorkoutExercise? { phase?.exercises[safe: pos.exerciseIdx] }
    var isCircuit: Bool          { phase?.isCircuit == true }
    var phaseRounds: Int         { phase?.roundCount ?? 1 }

    // MARK: - Progress

    var progressPct: Double {
        let total = workout.phases.reduce(0) { sum, p in
            let s = p.exercises.reduce(0) { $0 + $1.sets }
            return sum + (p.isCircuit ? s * p.roundCount : s)
        }
        guard total > 0 else { return 0 }
        var step = 0
        for i in 0..<pos.phaseIdx {
            let p = workout.phases[i]
            let s = p.exercises.reduce(0) { $0 + $1.sets }
            step += p.isCircuit ? s * p.roundCount : s
        }
        if let ph = phase {
            if isCircuit {
                let roundSets = ph.exercises.reduce(0) { $0 + $1.sets }
                step += (pos.roundNum - 1) * roundSets
                for i in 0..<pos.exerciseIdx { step += ph.exercises[i].sets }
            } else {
                for i in 0..<pos.exerciseIdx { step += ph.exercises[i].sets }
                step += pos.setNum - 1
            }
        }
        return Double(step) / Double(total)
    }

    var nextPreview: (label: String, name: String)? {
        guard let ph = phase, let ex = exercise else { return nil }
        if isCircuit {
            if pos.exerciseIdx < ph.exercises.count - 1 {
                return ("Next", ph.exercises[pos.exerciseIdx + 1].name)
            }
            if pos.roundNum < phaseRounds {
                return ("Round \(pos.roundNum + 1)", ph.exercises[0].name)
            }
            if pos.phaseIdx < workout.phases.count - 1 {
                let next = workout.phases[pos.phaseIdx + 1]
                return (next.name, next.exercises.first?.name ?? "")
            }
            return ("Done", "Final stretch!")
        }
        if pos.setNum < ex.sets {
            return ("Next Set", "\(ex.name) — Set \(pos.setNum + 1) of \(ex.sets)")
        }
        if pos.exerciseIdx < ph.exercises.count - 1 {
            return ("Up Next", ph.exercises[pos.exerciseIdx + 1].name)
        }
        if pos.phaseIdx < workout.phases.count - 1 {
            return ("Up Next", workout.phases[pos.phaseIdx + 1].exercises.first?.name ?? "")
        }
        return ("Done", "Final stretch!")
    }

    // MARK: - Init

    init(workout: Workout, beepPlayer: BeepPlayer) {
        self.workout = workout
        self.beepPlayer = beepPlayer
    }

    // MARK: - Lifecycle

    func start() {
        startElapsedTimer()
        let firstPhase = workout.phases.first
        if let transRest = firstPhase?.transitionRestSecs, transRest > 0 {
            state = .phaseTransition
            timerValue = transRest
            startTick()
        } else {
            enterExercise(firstPhase?.exercises.first)
        }
    }

    func cleanup() {
        tickTask?.cancel()
        elapsedTask?.cancel()
    }

    // MARK: - Pause / mute

    func togglePause() {
        isPaused.toggle()
        if isPaused {
            pauseStart = Date()
        } else if let ps = pauseStart {
            pauseAccumulated += Date().timeIntervalSince(ps)
            pauseStart = nil
        }
    }

    // MARK: - User actions

    func handleExerciseDone() {
        tickTask?.cancel()
        guard let ph = phase, let ex = exercise else { return }

        // Bilateral: first side done → flip to second side (no rest)
        if ex.isBothSides && ex.type == .timed && sideNum == 0 {
            sideNum = 1
            timerValue = ex.durationSecs
            startTick()
            return
        }

        if ph.isCircuit {
            let isLastEx    = pos.exerciseIdx >= ph.exercises.count - 1
            let isLastRound = pos.roundNum >= phaseRounds
            let isLastPhase = pos.phaseIdx >= workout.phases.count - 1

            if isLastEx && isLastRound && isLastPhase { finishWorkout(); return }

            // Phase transition takes priority over regular rest
            if isLastEx && isLastRound && !isLastPhase {
                let nextPhase = workout.phases[pos.phaseIdx + 1]
                if let tr = nextPhase.transitionRestSecs, tr > 0 {
                    pos = TimerPosition(phaseIdx: pos.phaseIdx + 1)
                    transitionToPhase(nextPhase)
                    return
                }
            }

            let rest = ph.defaultRestSecs
            if rest > 0 { enterRest() } else { advanceToNext() }
            return
        }

        // Default mode
        let isLastSet   = pos.setNum >= ex.sets
        let isLastEx    = pos.exerciseIdx >= ph.exercises.count - 1
        let isLastPhase = pos.phaseIdx >= workout.phases.count - 1

        if isLastSet && isLastEx && isLastPhase { finishWorkout(); return }

        if isLastSet && isLastEx && !isLastPhase {
            let nextPhase = workout.phases[pos.phaseIdx + 1]
            if let tr = nextPhase.transitionRestSecs, tr > 0 {
                pos = TimerPosition(phaseIdx: pos.phaseIdx + 1)
                transitionToPhase(nextPhase)
                return
            }
        }

        let rest = getRestDuration()
        if rest > 0 { enterRest() } else { advanceToNext() }
    }

    func handleGoBack() {
        tickTask?.cancel()
        guard let ph = phase else { return }

        if state == .rest || state == .prep {
            enterExercise(exercise)
            return
        }

        // Bilateral: back from second side → restart first side
        if state == .exercise && sideNum == 1, let ex = exercise, ex.isBothSides && ex.type == .timed {
            sideNum = 0
            timerValue = ex.durationSecs
            startTick()
            return
        }

        if state == .phaseTransition {
            if pos.phaseIdx > 0 {
                let prevPhase = workout.phases[pos.phaseIdx - 1]
                pos = TimerPosition(
                    phaseIdx: pos.phaseIdx - 1,
                    exerciseIdx: prevPhase.exercises.count - 1,
                    setNum: prevPhase.isCircuit ? 1 : (prevPhase.exercises.last?.sets ?? 1),
                    roundNum: prevPhase.isCircuit ? prevPhase.roundCount : 1
                )
            }
            enterExercise(exercise)
            return
        }

        if ph.isCircuit {
            if pos.exerciseIdx > 0 {
                pos.exerciseIdx -= 1
            } else if pos.roundNum > 1 {
                pos.exerciseIdx = ph.exercises.count - 1
                pos.roundNum -= 1
            } else if pos.phaseIdx > 0 {
                let prevPhase = workout.phases[pos.phaseIdx - 1]
                pos = TimerPosition(
                    phaseIdx: pos.phaseIdx - 1,
                    exerciseIdx: prevPhase.exercises.count - 1,
                    setNum: prevPhase.isCircuit ? 1 : (prevPhase.exercises.last?.sets ?? 1),
                    roundNum: prevPhase.isCircuit ? prevPhase.roundCount : 1
                )
            }
            enterExercise(exercise)
            return
        }

        // Default mode
        if pos.setNum > 1 {
            pos.setNum -= 1
        } else if pos.exerciseIdx > 0 {
            let prevEx = ph.exercises[pos.exerciseIdx - 1]
            pos.exerciseIdx -= 1
            pos.setNum = prevEx.sets
        } else if pos.phaseIdx > 0 {
            let prevPhase = workout.phases[pos.phaseIdx - 1]
            pos = TimerPosition(
                phaseIdx: pos.phaseIdx - 1,
                exerciseIdx: prevPhase.exercises.count - 1,
                setNum: prevPhase.isCircuit ? 1 : (prevPhase.exercises.last?.sets ?? 1),
                roundNum: prevPhase.isCircuit ? prevPhase.roundCount : 1
            )
        }
        enterExercise(exercise)
    }

    func handleSkip() {
        switch state {
        case .rest:
            tickTask?.cancel()
            advanceToNext()
        case .prep:
            tickTask?.cancel()
            state = .exercise
            timerValue = exercise?.durationSecs
            if exercise?.type == .timed { startTick() }
        case .phaseTransition:
            tickTask?.cancel()
            enterExercise(phase?.exercises.first)
        default:
            handleExerciseDone()
        }
    }

    func handleSkipOptional() {
        tickTask?.cancel()
        guard let ph = phase else { return }
        let isLastEx    = pos.exerciseIdx >= ph.exercises.count - 1
        let isLastPhase = pos.phaseIdx >= workout.phases.count - 1

        if ph.isCircuit {
            if !isLastEx {
                pos.exerciseIdx += 1
                enterExercise(ph.exercises[pos.exerciseIdx])
                return
            }
            if pos.roundNum < phaseRounds {
                pos.exerciseIdx = 0
                pos.roundNum += 1
                enterExercise(ph.exercises.first)
                return
            }
        }

        if isLastEx && isLastPhase { finishWorkout(); return }

        if isLastEx {
            let nextPhase = workout.phases[pos.phaseIdx + 1]
            pos = TimerPosition(phaseIdx: pos.phaseIdx + 1)
            if let tr = nextPhase.transitionRestSecs, tr > 0 {
                transitionToPhase(nextPhase)
            } else {
                enterExercise(nextPhase.exercises.first)
            }
        } else {
            pos.exerciseIdx += 1
            pos.setNum = 1
            enterExercise(exercise)
        }
    }

    func handleSkipPhase() {
        tickTask?.cancel()
        let isLastPhase = pos.phaseIdx >= workout.phases.count - 1
        if isLastPhase { finishWorkout(); return }
        let nextPhase = workout.phases[pos.phaseIdx + 1]
        pos = TimerPosition(phaseIdx: pos.phaseIdx + 1)
        if let tr = nextPhase.transitionRestSecs, tr > 0 {
            transitionToPhase(nextPhase)
        } else {
            enterExercise(nextPhase.exercises.first)
        }
    }

    // MARK: - Internal transitions

    private func enterExercise(_ ex: WorkoutExercise?) {
        let target = ex ?? exercise
        sideNum = 0
        let needsPrep = target?.type == .timed && (target?.prepSecs ?? 0) > 0
        state = needsPrep ? .prep : .exercise
        timerValue = needsPrep ? target?.prepSecs : (target?.type == .timed ? target?.durationSecs : nil)
        if timerValue != nil { startTick() }
    }

    private func enterRest() {
        state = .rest
        timerValue = getRestDuration()
        startTick()
    }

    private func transitionToPhase(_ nextPhase: WorkoutPhase) {
        state = .phaseTransition
        timerValue = nextPhase.transitionRestSecs
        startTick()
    }

    private func advanceToNext() {
        guard let ph = phase else { return }

        if ph.isCircuit {
            let isLastEx    = pos.exerciseIdx >= ph.exercises.count - 1
            let isLastRound = pos.roundNum >= phaseRounds
            let isLastPhase = pos.phaseIdx >= workout.phases.count - 1

            if !isLastEx {
                pos.exerciseIdx += 1
                enterExercise(ph.exercises[pos.exerciseIdx])
                return
            }
            if !isLastRound {
                pos.exerciseIdx = 0
                pos.roundNum += 1
                enterExercise(ph.exercises.first)
                return
            }
            if !isLastPhase {
                let nextPhase = workout.phases[pos.phaseIdx + 1]
                pos = TimerPosition(phaseIdx: pos.phaseIdx + 1)
                if let tr = nextPhase.transitionRestSecs, tr > 0 {
                    transitionToPhase(nextPhase)
                } else {
                    enterExercise(nextPhase.exercises.first)
                }
                return
            }
            finishWorkout()
            return
        }

        // Default mode
        guard let ex = exercise else { return }
        let isLastSet   = pos.setNum >= ex.sets
        let isLastEx    = pos.exerciseIdx >= ph.exercises.count - 1
        let isLastPhase = pos.phaseIdx >= workout.phases.count - 1

        if !isLastSet {
            pos.setNum += 1
            enterExercise(ex)
            return
        }
        if !isLastEx {
            pos.exerciseIdx += 1
            pos.setNum = 1
            enterExercise(ph.exercises[pos.exerciseIdx])
            return
        }
        if !isLastPhase {
            let nextPhase = workout.phases[pos.phaseIdx + 1]
            pos = TimerPosition(phaseIdx: pos.phaseIdx + 1)
            if let tr = nextPhase.transitionRestSecs, tr > 0 {
                transitionToPhase(nextPhase)
            } else {
                enterExercise(nextPhase.exercises.first)
            }
            return
        }
        finishWorkout()
    }

    private func finishWorkout() {
        tickTask?.cancel()
        elapsedTask?.cancel()
        if !isMuted { beepPlayer.complete() }
        state = .complete
    }

    private func getRestDuration() -> Int {
        guard let ph = phase, let ex = exercise else { return 0 }
        if ph.isCircuit { return ph.defaultRestSecs }
        if pos.setNum < ex.sets { return ex.restBetweenSetsSecs ?? ph.defaultRestSecs }
        return ex.restAfterExerciseSecs ?? ph.defaultRestSecs
    }

    // MARK: - Tick

    private func startTick() {
        tickTask?.cancel()
        tickTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { break }
                guard !isPaused, let t = timerValue else { continue }
                if t <= 0 {
                    handleTimerExpired()
                } else {
                    if t <= 3 && !isMuted { beepPlayer.countdown3() }
                    timerValue = t - 1
                }
            }
        }
    }

    private func handleTimerExpired() {
        tickTask?.cancel()
        if !isMuted { beepPlayer.transition() }
        switch state {
        case .exercise:       handleExerciseDone()
        case .rest:           advanceToNext()
        case .prep:
            state = .exercise
            timerValue = exercise?.durationSecs
            if timerValue != nil { startTick() }
        case .phaseTransition:
            enterExercise(phase?.exercises.first)
        default:
            break
        }
    }

    // MARK: - Elapsed timer

    private func startElapsedTimer() {
        elapsedStart = Date()
        elapsedTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 500_000_000)
                guard !Task.isCancelled else { break }
                let now = Date()
                let paused = pauseAccumulated + (pauseStart.map { now.timeIntervalSince($0) } ?? 0)
                totalElapsed = max(0, Int(now.timeIntervalSince(elapsedStart) - paused))
            }
        }
    }
}
