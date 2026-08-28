import { Link } from "wouter";
import { Workout, countExercises, countSets, formatTimer } from "@/lib/workouts";

export function WarmWorkoutComplete({ workout, elapsed }: { workout: Workout; elapsed: number }) {
  return (
    <div className="wi-shell">
      <div className="wtx-complete-shell">
        <div className="wtx-complete-card">
          <span className="wtx-complete-badge">WORKOUT COMPLETE</span>
          <div className="wtx-complete-title">
            <span className="wtx-complete-title__name">{workout.title}</span>
            <span className="wtx-complete-title__subtitle">
              {workout.workout_type.toUpperCase()} · {workout.subtitle.toUpperCase()}
            </span>
          </div>
          <div className="wtx-complete-time">
            <span className="wtx-complete-time__value">{formatTimer(elapsed)}</span>
            <span className="wtx-complete-time__label">TOTAL TIME</span>
          </div>
          <div className="wtx-complete-stats">
            <div className="wtx-complete-stat">
              <strong>{countExercises(workout)}</strong>
              <span>EXERCISES</span>
            </div>
            <div className="wtx-complete-stat">
              <strong>{countSets(workout)}</strong>
              <span>SETS</span>
            </div>
            <div className="wtx-complete-stat">
              <strong>{workout.phases.length}</strong>
              <span>BLOCKS</span>
            </div>
          </div>
          {workout.coaching_note ? (
            <p className="wtx-complete-note">{workout.coaching_note} — Coach</p>
          ) : null}
          <div className="wtx-complete-actions">
            <Link href="/workouts" className="is-primary">
              Back to workouts
            </Link>
            <Link href="/" className="is-secondary">
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
