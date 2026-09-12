import { useEffect, useRef, useState } from "react";
import { Workout, countExercises } from "@/lib/workouts";
import { useTimerEngine } from "./useTimerEngine";
import {
  accentFor,
  buildUpNext,
  FocusCard,
  SessionNoteCard,
  TimerHeaderRight,
  TimerTopBar,
  UpNextCard,
} from "@/components/workout-timer-warm/WorkoutTimerWidgets";

export function WarmActiveTimer({
  workout,
  onComplete,
  onQuit,
}: {
  workout: Workout;
  onComplete: (elapsed: number) => void;
  onQuit: () => void;
}) {
  const [showQuitDialog, setShowQuitDialog] = useState(false);
  const engine = useTimerEngine(workout, onComplete);
  const {
    state,
    pos,
    timer,
    stateDuration,
    isPaused,
    setIsPaused,
    muted,
    toggleMute,
    totalElapsed,
    phase,
    exercise,
    isCircuit,
    phaseRounds,
    currentSide,
    handleExerciseDone,
    handleGoBack,
    handleSkip,
  } = engine;

  const stateRef = useRef(state);
  stateRef.current = state;
  const quitDialogRef = useRef<HTMLDivElement>(null);
  const quitTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (showQuitDialog) return;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (stateRef.current === "exercise" && exercise?.type === "reps") {
            handleExerciseDone();
          } else {
            setIsPaused((p) => !p);
          }
          break;
        case "Enter":
          e.preventDefault();
          if (stateRef.current === "exercise" && exercise?.type === "reps") {
            handleExerciseDone();
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          handleSkip();
          break;
        case "ArrowLeft":
          e.preventDefault();
          handleGoBack();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [showQuitDialog, exercise, handleExerciseDone, setIsPaused, handleSkip, handleGoBack]);

  useEffect(() => {
    if (!showQuitDialog) return;
    const focusables = Array.from(
      quitDialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    focusables[0]?.focus();

    const handleDialogKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        setShowQuitDialog(false);
        return;
      }
      if (e.code !== "Tab" || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKey);
    return () => {
      window.removeEventListener("keydown", handleDialogKey);
      quitTriggerRef.current?.focus();
    };
  }, [showQuitDialog]);

  if (!phase || !exercise) return null;

  const total = countExercises(workout);
  const exOfBlock = `${pos.exerciseIdx + 1}/${phase.exercises.length}`;
  const setLabel = isCircuit
    ? `Round ${pos.roundNum} of ${phaseRounds}`
    : `Set ${pos.setNum} of ${exercise.sets}`;
  const restCaption =
    state === "rest" && isCircuit
      ? `REST · ROUND ${pos.roundNum}/${phaseRounds} — NEXT SET AUTO-STARTS`
      : "REST — NEXT SET AUTO-STARTS";
  const screen: "exercise" | "prep" | "rest" | "phase_transition" =
    state === "prep" || state === "rest" || state === "phase_transition" ? state : "exercise";

  const upNext = buildUpNext(workout, pos.phaseIdx, pos.exerciseIdx);
  const isReps = state === "exercise" && exercise.type === "reps";

  return (
    <div className="wi-shell">
      <div className="wi-board wtx-active-board">
        <TimerTopBar
          onBack={() => {
            quitTriggerRef.current = document.activeElement as HTMLElement;
            setShowQuitDialog(true);
          }}
          title={workout.title}
          sportLabel={workout.workout_type.toUpperCase()}
          sportAccent={accentFor(workout.workout_type)}
          right={
            <TimerHeaderRight muted={muted} onToggleMute={toggleMute} seconds={totalElapsed} />
          }
        />
        <main className="wtx-grid">
          <FocusCard
            blockLabel={phase.name}
            exOfBlock={exOfBlock}
            exNum={exercise.num}
            exTotal={total}
            exercise={exercise}
            setLabel={setLabel}
            optional={exercise.optional}
            screen={screen}
            timer={timer}
            stateDuration={stateDuration}
            currentSide={currentSide}
            restCaption={restCaption}
            phaseTransitionName={workout.phases[pos.phaseIdx]?.name}
            nextUp={upNext[0]}
            controls={{
              onPrev: handleGoBack,
              onNext: handleSkip,
              primaryLabel: isReps ? "Done" : isPaused ? "▶ Resume" : "❚❚ Pause",
              onPrimary: isReps ? handleExerciseDone : () => setIsPaused((p) => !p),
            }}
          />
          <div className="wtx-rail">
            <UpNextCard rows={upNext} />
            <SessionNoteCard note={workout.coaching_note} />
          </div>
        </main>
      </div>

      {showQuitDialog ? (
        <div className="wtx-dialog-backdrop">
          <div
            ref={quitDialogRef}
            className="wtx-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wtx-quit-dialog-title"
          >
            <h3 id="wtx-quit-dialog-title">Quit workout?</h3>
            <p>Your progress will be lost.</p>
            <div className="wtx-dialog__actions">
              <button
                type="button"
                className="is-continue"
                onClick={() => setShowQuitDialog(false)}
              >
                Continue
              </button>
              <button type="button" className="is-quit" onClick={onQuit}>
                Quit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
