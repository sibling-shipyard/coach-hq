import { CSSProperties } from "react";
import { Workout, countExercises, countSets } from "@/lib/workouts";
import {
  SportBadge,
  TimerTopBar,
  accentFor,
  doseFor,
} from "@/components/workout-timer-warm/WorkoutTimerWidgets";

export function WarmWorkoutOverview({
  workout,
  onStart,
}: {
  workout: Workout;
  onStart: () => void;
}) {
  const accent = accentFor(workout.workout_type);
  const exercises = countExercises(workout);
  const sets = countSets(workout);

  return (
    <div className="wi-shell">
      <div className="wi-board" style={{ maxWidth: 760 }}>
        <TimerTopBar backHref="/workouts" title={workout.title} />

        <div className="wtx-ov-page">
          <div className="wtx-ov-meta">
            <SportBadge label={workout.workout_type.toUpperCase()} accent={accent} />
            <p className="wtx-ov-subtitle">{workout.subtitle}</p>
            <div className="wtx-ov-stats">
              <span>{workout.estimated_duration_mins}M</span>
              <span>{exercises} EXERCISES</span>
              <span>{sets} SETS</span>
            </div>
          </div>

          {workout.coaching_note ? (
            <p className="wtx-ov-note" style={{ "--sport-accent": accent } as CSSProperties}>
              {workout.coaching_note}
            </p>
          ) : null}

          {workout.equipment?.length ? (
            <div className="wtx-ov-equipment">
              <span className="wtx-ov-equipment__label">EQUIPMENT</span>
              <span className="wtx-ov-equipment__body">{workout.equipment.join(" · ")}</span>
            </div>
          ) : null}

          <div className="wtx-ov-blocks">
            {workout.phases.map((phase) => (
              <div className="wtx-ov-block" key={phase.name}>
                <div className="wtx-ov-block__head">
                  <div className="wtx-ov-block__head-left">
                    <span className="wtx-ov-block__name">{phase.name}</span>
                    {phase.circuit ? (
                      <span className="wtx-ov-block__rounds">↻ {phase.rounds ?? 1}×</span>
                    ) : null}
                  </div>
                  <span className="wtx-ov-block__duration">{phase.duration}</span>
                </div>
                {phase.exercises.map((ex) => (
                  <div className="wtx-ov-row" key={ex.num}>
                    <span className="wtx-ov-row__n">{ex.num}</span>
                    <div className="wtx-ov-row__body">
                      <div className="wtx-ov-row__name-line">
                        <span className="wtx-ov-row__name">{ex.name}</span>
                        {ex.optional ? (
                          <span className="wtx-ov-row__optional">OPTIONAL</span>
                        ) : null}
                      </div>
                      <span className="wtx-ov-row__cue">{ex.form_cue}</span>
                    </div>
                    <span className="wtx-ov-row__dose">{doseFor(ex)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <button type="button" className="wtx-ov-start" onClick={onStart}>
            ▶ Start workout
          </button>
        </div>
      </div>
    </div>
  );
}
