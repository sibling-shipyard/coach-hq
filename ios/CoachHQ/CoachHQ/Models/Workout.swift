import Foundation

enum WorkoutType: String, Codable, Hashable {
    case foundation, calisthenics, recovery, realign
}

enum ExerciseType: String, Codable, Hashable {
    case timed, reps
}

struct WorkoutExercise: Codable, Identifiable, Hashable {
    var id: Int { num }
    let num: Int
    let name: String
    let type: ExerciseType
    let durationSecs: Int?
    let reps: Int?
    let sets: Int
    let restBetweenSetsSecs: Int?
    let restAfterExerciseSecs: Int?
    let prepSecs: Int?
    let optional: Bool?
    let bothSides: Bool?
    let formCue: String
    let why: String

    enum CodingKeys: String, CodingKey {
        case num, name, type, reps, sets, optional, why
        case durationSecs = "duration_secs"
        case restBetweenSetsSecs = "rest_between_sets_secs"
        case restAfterExerciseSecs = "rest_after_exercise_secs"
        case prepSecs = "prep_secs"
        case bothSides = "both_sides"
        case formCue = "form_cue"
    }

    var isOptional: Bool { optional == true }
    var isBothSides: Bool { bothSides == true }
}

struct WorkoutPhase: Codable, Identifiable, Hashable {
    var id: String { name }
    let name: String
    let duration: String
    let defaultRestSecs: Int
    let transitionRestSecs: Int?
    let optional: Bool?
    let coachingNote: String?
    let exercises: [WorkoutExercise]
    let circuit: Bool?
    let rounds: Int?

    enum CodingKeys: String, CodingKey {
        case name, duration, optional, exercises, circuit, rounds
        case defaultRestSecs = "default_rest_secs"
        case transitionRestSecs = "transition_rest_secs"
        case coachingNote = "coaching_note"
    }

    var isCircuit: Bool { circuit == true }
    var roundCount: Int { rounds ?? 1 }
    var isOptional: Bool { optional == true }
}

struct Workout: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String
    let sessionDate: String?
    let basedOnTemplate: String?
    let workoutType: WorkoutType
    let estimatedDurationMins: Int
    let location: String
    let equipment: [String]
    let coachingNote: String
    let phases: [WorkoutPhase]
    let progressionNotes: String?

    enum CodingKeys: String, CodingKey {
        case id, title, subtitle, location, equipment, phases
        case sessionDate = "session_date"
        case basedOnTemplate = "based_on_template"
        case workoutType = "workout_type"
        case estimatedDurationMins = "estimated_duration_mins"
        case coachingNote = "coaching_note"
        case progressionNotes = "progression_notes"
    }

    var isCoachAdjusted: Bool { sessionDate != nil }

    var exerciseCount: Int { phases.reduce(0) { $0 + $1.exercises.count } }

    var setCount: Int {
        phases.reduce(0) { sum, phase in
            let phaseSets = phase.exercises.reduce(0) { $0 + $1.sets }
            return sum + (phase.isCircuit ? phaseSets * phase.roundCount : phaseSets)
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
