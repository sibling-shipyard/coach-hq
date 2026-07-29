import SwiftUI

// MARK: - Helpers (mirrors ui/client/src/components/workout-timer-warm/WorkoutTimerWidgets.tsx)

enum WorkoutTimerWarm {
    static let amber = Color(red: 0xA8 / 255, green: 0x70 / 255, blue: 0x2C / 255)
    static let rust = WarmInstrument.accent
    static let restAccent = WarmInstrument.alarmFg

    struct UpNextItem: Identifiable {
        var id: Int { num }
        let num: Int
        let name: String
        let block: String
        let dose: String
    }

    struct BlockTags {
        let tags: [String]
        let overflow: Int
    }

    static func doseFor(_ exercise: WorkoutExercise) -> String {
        if exercise.type == .timed {
            return "\(exercise.sets)×\(exercise.durationSecs ?? 0)s"
        }
        return "\(exercise.sets)×\(exercise.reps ?? 0)"
    }

    static func singleDoseFor(_ exercise: WorkoutExercise) -> String {
        if exercise.type == .timed {
            return "1×\(exercise.durationSecs ?? 0)s"
        }
        return "1×\(exercise.reps ?? 0)"
    }

    static func deriveBlockTags(from workout: Workout, limit: Int = 4) -> BlockTags {
        var seen: [String] = []
        for phase in workout.phases {
            let tag = phase.name.split(separator: "—", maxSplits: 1).first?
                .trimmingCharacters(in: .whitespaces) ?? phase.name
            if !seen.contains(tag) { seen.append(tag) }
        }
        return BlockTags(tags: Array(seen.prefix(limit)), overflow: Swift.max(0, seen.count - limit))
    }

    static func buildUpNext(
        workout: Workout,
        phaseIdx: Int,
        exerciseIdx: Int,
        count: Int = 4
    ) -> [UpNextItem] {
        var flat: [(phase: WorkoutPhase, exercise: WorkoutExercise)] = []
        for phase in workout.phases {
            for exercise in phase.exercises {
                flat.append((phase, exercise))
            }
        }
        guard phaseIdx < workout.phases.count,
              exerciseIdx < workout.phases[phaseIdx].exercises.count else { return [] }
        let currentNum = workout.phases[phaseIdx].exercises[exerciseIdx].num
        guard let currentIdx = flat.firstIndex(where: { $0.exercise.num == currentNum }) else { return [] }
        return flat.dropFirst(currentIdx + 1).prefix(count).map { entry in
            UpNextItem(
                num: entry.exercise.num,
                name: entry.exercise.name,
                block: entry.phase.isCircuit
                    ? "\(entry.phase.name) · \(entry.phase.roundCount)×"
                    : entry.phase.name,
                dose: doseFor(entry.exercise)
            )
        }
    }

    static func formatTimer(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return String(format: "%02d:%02d", s / 60, s % 60)
    }

    static func readoutColor(for state: TimerState) -> Color {
        switch state {
        case .prep: return amber
        case .rest, .phaseTransition: return restAccent
        default: return rust
        }
    }

    static func timerCaption(
        state: TimerState,
        exercise: WorkoutExercise?,
        sideNum: Int,
        isCircuit: Bool,
        roundNum: Int,
        phaseRounds: Int,
        phaseName: String?
    ) -> String {
        switch state {
        case .phaseTransition:
            return "NEXT BLOCK — \(phaseName ?? "")"
        case .prep:
            return "GET READY — GET INTO POSITION"
        case .rest:
            if isCircuit {
                return "REST · ROUND \(roundNum)/\(phaseRounds) — NEXT SET AUTO-STARTS"
            }
            return "REST — NEXT SET AUTO-STARTS"
        case .exercise:
            guard let exercise else { return "" }
            if exercise.type == .reps { return "REPS — TAP DONE WHEN FINISHED" }
            if exercise.isBothSides {
                return sideNum == 0 ? "LEFT SIDE — HOLD" : "RIGHT SIDE — HOLD"
            }
            return "COUNTDOWN — AUTO-ADVANCES AT 0"
        case .complete:
            return ""
        }
    }
}

// MARK: - Sport badge

struct WarmWorkoutTypeBadge: View {
    let label: String
    let accent: Color

    var body: some View {
        Text(label)
            .font(WarmInstrument.monoLabel(9))
            .kerning(1)
            .foregroundColor(WarmInstrument.paper)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(accent)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

// MARK: - Mute + elapsed header cluster

struct WarmTimerHeaderRight: View {
    let muted: Bool
    let elapsed: Int
    let onToggleMute: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onToggleMute) {
                Text(muted ? "♪̸" : "♪")
                    .font(.system(size: 13))
                    .foregroundColor(muted ? WarmInstrument.inkFaint : WorkoutTimerWarm.rust)
                    .frame(width: 30, height: 30)
                    .background(muted ? WarmInstrument.surfaceMuted : WorkoutTimerWarm.rust.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 9)
                            .stroke(muted ? WarmInstrument.headerRule : WorkoutTimerWarm.rust, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)

            Text(WorkoutTimerWarm.formatTimer(elapsed))
                .font(WarmInstrument.figures(12, weight: .bold))
                .foregroundColor(Color(red: 0x4A / 255, green: 0x4C / 255, blue: 0x45 / 255))
        }
    }
}

// MARK: - Side pills (both-sides exercises)

struct WarmSidePills: View {
    let sideNum: Int

    var body: some View {
        HStack(spacing: 6) {
            sidePill("LEFT", active: sideNum == 0)
            sidePill("RIGHT", active: sideNum == 1)
        }
    }

    private func sidePill(_ label: String, active: Bool) -> some View {
        Text(label)
            .font(WarmInstrument.monoLabel(10))
            .kerning(0.8)
            .foregroundColor(active ? WarmInstrument.paper : WarmInstrument.inkFaint)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .background(active ? WorkoutTimerWarm.rust : Theme.mutedBackground)
            .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

// MARK: - Form cue + coach why (mobile merged card)

struct WarmFormCueCard: View {
    let formCue: String
    let why: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("FORM CUE")
                .font(WarmInstrument.monoLabel(8.5))
                .kerning(1.4)
                .foregroundColor(WarmInstrument.inkFaint)
            Text(formCue)
                .font(.system(size: 14))
                .foregroundColor(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(why) — Coach")
                .font(WarmInstrument.coachVoice(13.5))
                .foregroundColor(Color(red: 0x6B / 255, green: 0x6D / 255, blue: 0x64 / 255))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(WarmInstrument.surfaceMuted)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Next preview strip (iPhone mock)

struct WarmNextStrip: View {
    let name: String
    let dose: String

    var body: some View {
        HStack(spacing: 10) {
            Text("NEXT")
                .font(WarmInstrument.monoLabel(8.5))
                .kerning(1.4)
                .foregroundColor(WarmInstrument.inkFaint)
            Text(name)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Theme.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
            Text(dose)
                .font(WarmInstrument.figures(11))
                .foregroundColor(Color(red: 0x4A / 255, green: 0x4C / 255, blue: 0x45 / 255))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(WarmInstrument.borderDashed, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        )
    }
}

// MARK: - Timer controls (docked bottom bar)

struct WarmTimerControls: View {
    let primaryLabel: String
    let onPrev: () -> Void
    let onPrimary: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Spacer(minLength: 0)

            controlButton(systemName: "backward.end.fill", action: onPrev)

            Button(action: onPrimary) {
                Text(primaryLabel)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(WarmInstrument.paper)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(WorkoutTimerWarm.rust)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .shadow(color: WorkoutTimerWarm.rust.opacity(0.28), radius: 8, y: 4)
            }
            .buttonStyle(TimerWarmPressStyle())
            .frame(maxWidth: 190)

            controlButton(systemName: "forward.end.fill", action: onNext)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .background(WarmInstrument.paper)
        .safeAreaPadding(.bottom, 8)
    }

    private func controlButton(systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 17, weight: .medium))
                .foregroundColor(Color(red: 0x4A / 255, green: 0x4C / 255, blue: 0x45 / 255))
                .frame(width: 56, height: 56)
                .background(WarmInstrument.paper)
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(WarmInstrument.headerRule, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(TimerWarmPressStyle())
    }
}

struct TimerWarmPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.15, bounce: 0), value: configuration.isPressed)
    }
}

// MARK: - Terracotta CTA (Start / Back to workouts)

struct WarmPrimaryCTA: View {
    let title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .kerning(0.3)
                .foregroundColor(WarmInstrument.paper)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(WorkoutTimerWarm.rust)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: WorkoutTimerWarm.rust.opacity(0.28), radius: 8, y: 4)
        }
        .buttonStyle(TimerWarmPressStyle())
    }
}

struct WarmSecondaryCTA: View {
    let title: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundColor(Theme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(WarmInstrument.paper)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color(red: 0xCA / 255, green: 0xBF / 255, blue: 0xA9 / 255), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(TimerWarmPressStyle())
    }
}

// MARK: - Quit dialog (mirrors wtx-dialog in workout-timer-warm.css)

struct WarmQuitDialog: View {
    let onContinue: () -> Void
    let onQuit: () -> Void

    var body: some View {
        ZStack {
            Color(red: 43 / 255, green: 45 / 255, blue: 41 / 255)
                .opacity(0.45)
                .ignoresSafeArea()
                .onTapGesture(perform: onContinue)

            VStack(alignment: .leading, spacing: 0) {
                Text("Quit workout?")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Theme.ink)
                    .padding(.bottom, 8)

                Text("Your progress will be lost.")
                    .font(.system(size: 13.5))
                    .foregroundColor(WarmInstrument.inkFaint)
                    .padding(.bottom, 20)

                HStack(spacing: 12) {
                    WarmDialogActionButton(title: "Continue", style: .secondary, action: onContinue)
                    WarmDialogActionButton(title: "Quit", style: .primary, action: onQuit)
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 24)
            .frame(maxWidth: 340)
            .background(WarmInstrument.paper)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(WarmInstrument.border, lineWidth: 1)
            )
            .shadow(color: Color(red: 43 / 255, green: 45 / 255, blue: 41 / 255).opacity(0.25), radius: 24, y: 12)
            .padding(.horizontal, 16)
        }
    }
}

private struct WarmDialogActionButton: View {
    enum Style { case primary, secondary }

    let title: String
    let style: Style
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(style == .primary ? WarmInstrument.paper : Theme.ink)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(style == .primary ? WorkoutTimerWarm.rust : WarmInstrument.paper)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(
                            style == .secondary ? WarmInstrument.headerRule : Color.clear,
                            lineWidth: 1
                        )
                )
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(TimerWarmPressStyle())
    }
}
