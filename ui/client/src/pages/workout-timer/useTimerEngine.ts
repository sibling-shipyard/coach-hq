import { useState, useEffect, useCallback, useRef, useMemo, Dispatch, SetStateAction } from "react";
import { Workout, Exercise, Phase } from "@/lib/workouts";
import { useBeep } from "./useBeep";

// ─── Types ─────────────────────────────────────────────────────────────────

export type TimerState = "overview" | "phase_transition" | "prep" | "exercise" | "rest" | "complete";

export interface TimerPosition {
  phaseIdx: number;
  exerciseIdx: number;
  setNum: number;   // 1-based — used in default mode
  roundNum: number; // 1-based — used in circuit mode
}

export interface UseTimerEngineReturn {
  state: TimerState;
  pos: TimerPosition;
  timer: number;
  stateDuration: number;
  isPaused: boolean;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  muted: boolean;
  toggleMute: () => void;
  totalElapsed: number;
  progressPct: number;
  phase: Phase | undefined;
  exercise: Exercise | undefined;
  isCircuit: boolean;
  phaseRounds: number;
  isRest: boolean;
  isPrep: boolean;
  isPhaseTransition: boolean;
  isReps: boolean;
  currentSide: 0 | 1;
  nextPreview: { label: string; name: string } | null;
  handleExerciseDone: () => void;
  handleGoBack: () => void;
  handleSkip: () => void;
  handleSkipOptional: () => void;
  handleSkipPhase: () => void;
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useTimerEngine(
  workout: Workout,
  onComplete: (elapsed: number) => void,
): UseTimerEngineReturn {
  const { countdown3, transitionBeep, completeBeep, muted, toggleMute } = useBeep();

  const [state, setState] = useState<TimerState>(() => {
    const firstPhase = workout.phases[0];
    if (firstPhase?.transition_rest_secs && firstPhase.transition_rest_secs > 0) {
      return "phase_transition";
    }
    const firstEx = firstPhase?.exercises[0];
    if (firstEx?.type === "timed" && firstEx.prep_secs && firstEx.prep_secs > 0) {
      return "prep";
    }
    return "exercise";
  });
  const [pos, setPos] = useState<TimerPosition>({
    phaseIdx: 0,
    exerciseIdx: 0,
    setNum: 1,
    roundNum: 1,
  });
  const [timer, setTimer] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);
  const [sideNum, setSideNum] = useState<0 | 1>(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const startTimeRef = useRef(Date.now());
  const advancingRef = useRef(false);

  // Reset advancingRef when state actually changes
  useEffect(() => {
    advancingRef.current = false;
  }, [state, pos]);

  // ─── Wake Lock ───────────────────────────────────────────────────────────
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Wake lock not available or denied
      }
    };
    void requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  const phase = workout.phases[pos.phaseIdx];
  const exercise = phase?.exercises[pos.exerciseIdx];
  const isCircuit = phase?.circuit === true;
  const phaseRounds = phase?.rounds ?? 1;

  // ─── Progress calculation ────────────────────────────────────────────────
  const totalSteps = useMemo(() => {
    return workout.phases.reduce((sum, p) => {
      const phaseSets = p.exercises.reduce((s, e) => s + e.sets, 0);
      if (p.circuit) {
        return sum + phaseSets * (p.rounds ?? 1);
      }
      return sum + phaseSets;
    }, 0);
  }, [workout]);

  const currentStep = useMemo(() => {
    let step = 0;
    for (let i = 0; i < pos.phaseIdx; i++) {
      const p = workout.phases[i];
      const pSets = p.exercises.reduce((s, e) => s + e.sets, 0);
      step += p.circuit ? pSets * (p.rounds ?? 1) : pSets;
    }
    if (isCircuit) {
      const roundSets = phase.exercises.reduce((s, e) => s + e.sets, 0);
      step += (pos.roundNum - 1) * roundSets;
      for (let i = 0; i < pos.exerciseIdx; i++) {
        step += phase.exercises[i].sets;
      }
    } else {
      for (let i = 0; i < pos.exerciseIdx; i++) {
        step += phase.exercises[i].sets;
      }
      step += pos.setNum - 1;
    }
    return step;
  }, [pos, workout, phase, isCircuit]);

  const progressPct = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;

  // ─── Refs to avoid stale closures ────────────────────────────────────────
  const stateRef = useRef(state);
  stateRef.current = state;
  const posRef = useRef(pos);
  posRef.current = pos;
  const totalElapsedRef = useRef(totalElapsed);
  totalElapsedRef.current = totalElapsed;
  const sideNumRef = useRef<0 | 1>(0);
  sideNumRef.current = sideNum;

  // Wall-clock timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused) {
        setTotalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      } else {
        startTimeRef.current = Date.now() - totalElapsedRef.current * 1000;
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  // ─── Rest duration resolver ──────────────────────────────────────────────
  const getRestDuration = useCallback((): number => {
    const curPos = posRef.current;
    const curPhase = workout.phases[curPos.phaseIdx];
    const curExercise = curPhase?.exercises[curPos.exerciseIdx];
    if (!curExercise) return 0;

    const curIsCircuit = curPhase.circuit === true;

    if (curIsCircuit) {
      return curPhase.default_rest_secs;
    }

    if (curPos.setNum < curExercise.sets) {
      return curExercise.rest_between_sets_secs ?? curPhase.default_rest_secs;
    }

    return curExercise.rest_after_exercise_secs ?? curPhase.default_rest_secs;
  }, [workout]);

  // ─── Should prep before current exercise? ───────────────────────────────
  const shouldPrep = useCallback((ex: Exercise | undefined): boolean => {
    if (!ex) return false;
    return ex.type === "timed" && (ex.prep_secs ?? 0) > 0;
  }, []);

  // ─── Enter exercise state ────────────────────────────────────────────────
  const enterExercise = useCallback((ex?: Exercise) => {
    const targetEx = ex ?? workout.phases[posRef.current.phaseIdx]?.exercises[posRef.current.exerciseIdx];
    setSideNum(0);
    setTimer(-1);
    if (shouldPrep(targetEx)) {
      setState("prep");
    } else {
      setState("exercise");
    }
  }, [workout, shouldPrep]);

  // ─── Advance to next exercise/set/round/phase ────────────────────────────
  const advanceToNext = useCallback(() => {
    if (advancingRef.current) return;
    advancingRef.current = true;

    const curPos = posRef.current;
    const curPhase = workout.phases[curPos.phaseIdx];
    const curExercise = curPhase?.exercises[curPos.exerciseIdx];
    if (!curExercise) return;

    const curIsCircuit = curPhase.circuit === true;
    const curRounds = curPhase.rounds ?? 1;

    if (curIsCircuit) {
      const isLastExercise = curPos.exerciseIdx >= curPhase.exercises.length - 1;

      if (!isLastExercise) {
        const nextEx = curPhase.exercises[curPos.exerciseIdx + 1];
        setPos((p) => ({ ...p, exerciseIdx: p.exerciseIdx + 1 }));
        enterExercise(nextEx);
        return;
      }

      if (curPos.roundNum < curRounds) {
        const firstEx = curPhase.exercises[0];
        setPos((p) => ({
          ...p,
          exerciseIdx: 0,
          roundNum: p.roundNum + 1,
        }));
        enterExercise(firstEx);
        return;
      }

      if (curPos.phaseIdx < workout.phases.length - 1) {
        const nextPhase = workout.phases[curPos.phaseIdx + 1];
        setPos({
          phaseIdx: curPos.phaseIdx + 1,
          exerciseIdx: 0,
          setNum: 1,
          roundNum: 1,
        });
        if (nextPhase.transition_rest_secs && nextPhase.transition_rest_secs > 0) {
          setTimer(-1);
          setState("phase_transition");
        } else {
          enterExercise(nextPhase.exercises[0]);
        }
        return;
      }

      completeBeep();
      onComplete(totalElapsedRef.current);
      return;
    }

    // ─── Default mode ───
    if (curPos.setNum < curExercise.sets) {
      setPos((p) => ({ ...p, setNum: p.setNum + 1 }));
      enterExercise(curExercise);
      return;
    }

    if (curPos.exerciseIdx < curPhase.exercises.length - 1) {
      const nextEx = curPhase.exercises[curPos.exerciseIdx + 1];
      setPos((p) => ({
        ...p,
        exerciseIdx: p.exerciseIdx + 1,
        setNum: 1,
      }));
      enterExercise(nextEx);
      return;
    }

    if (curPos.phaseIdx < workout.phases.length - 1) {
      const nextPhase = workout.phases[curPos.phaseIdx + 1];
      setPos({
        phaseIdx: curPos.phaseIdx + 1,
        exerciseIdx: 0,
        setNum: 1,
        roundNum: 1,
      });
      if (nextPhase.transition_rest_secs && nextPhase.transition_rest_secs > 0) {
        setTimer(-1);
        setState("phase_transition");
      } else {
        enterExercise(nextPhase.exercises[0]);
      }
      return;
    }

    completeBeep();
    onComplete(totalElapsedRef.current);
  }, [workout, completeBeep, onComplete, enterExercise]);

  // ─── Handle exercise done (one set done) ─────────────────────────────────
  const handleExerciseDone = useCallback(() => {
    const curPos = posRef.current;
    const curPhase = workout.phases[curPos.phaseIdx];
    const curExercise = curPhase?.exercises[curPos.exerciseIdx];
    if (!curExercise) return;

    const curIsCircuit = curPhase.circuit === true;
    const curRounds = curPhase.rounds ?? 1;

    // Bilateral: side 0 just finished → start side 1 (no rest, no prep, no set increment)
    if (curExercise.both_sides && curExercise.type === "timed" && sideNumRef.current === 0) {
      setSideNum(1);
      setTimer(-1);
      setState("exercise");
      return;
    }

    if (curIsCircuit) {
      const isLastExercise = curPos.exerciseIdx >= curPhase.exercises.length - 1;
      const isLastRound = curPos.roundNum >= curRounds;
      const isLastPhase = curPos.phaseIdx >= workout.phases.length - 1;

      if (isLastExercise && isLastRound && isLastPhase) {
        completeBeep();
        onComplete(totalElapsedRef.current);
        return;
      }

      if (isLastExercise && isLastRound && !isLastPhase) {
        const nextPhase = workout.phases[curPos.phaseIdx + 1];
        if (nextPhase?.transition_rest_secs && nextPhase.transition_rest_secs > 0) {
          setPos({ phaseIdx: curPos.phaseIdx + 1, exerciseIdx: 0, setNum: 1, roundNum: 1 });
          setTimer(-1);
          setState("phase_transition");
          return;
        }
      }

      const restAfter = curPhase.default_rest_secs;
      if (restAfter > 0) {
        setTimer(-1);
        setState("rest");
      } else {
        advanceToNext();
      }
      return;
    }

    // ─── Default mode ───
    const isLastSet = curPos.setNum >= curExercise.sets;
    const isLastExercise = curPos.exerciseIdx >= curPhase.exercises.length - 1;
    const isLastPhase = curPos.phaseIdx >= workout.phases.length - 1;

    if (isLastSet && isLastExercise && isLastPhase) {
      completeBeep();
      onComplete(totalElapsedRef.current);
      return;
    }

    if (isLastSet && isLastExercise && !isLastPhase) {
      const nextPhase = workout.phases[curPos.phaseIdx + 1];
      if (nextPhase?.transition_rest_secs && nextPhase.transition_rest_secs > 0) {
        setPos({
          phaseIdx: curPos.phaseIdx + 1,
          exerciseIdx: 0,
          setNum: 1,
          roundNum: 1,
        });
        setTimer(-1);
        setState("phase_transition");
        return;
      }
    }

    const restDuration = getRestDuration();
    if (restDuration > 0) {
      setTimer(-1);
      setState("rest");
    } else {
      advanceToNext();
    }
  }, [workout, completeBeep, onComplete, advanceToNext, getRestDuration]);

  // ─── Go back one step ────────────────────────────────────────────────────
  const handleGoBack = useCallback(() => {
    const curPos = posRef.current;
    const curState = stateRef.current;
    const curPhase = workout.phases[curPos.phaseIdx];
    const curIsCircuit = curPhase?.circuit === true;

    if (curState === "rest" || curState === "prep") {
      setTimer(-1);
      setState("exercise");
      return;
    }

    // Bilateral: back from side 1 → restart side 0 (same set)
    if (curState === "exercise" && sideNumRef.current === 1) {
      const backExercise = curPhase?.exercises[curPos.exerciseIdx];
      if (backExercise?.both_sides && backExercise.type === "timed") {
        setSideNum(0);
        setTimer(-1);
        setState("exercise");
        return;
      }
    }

    if (curState === "phase_transition") {
      if (curPos.phaseIdx > 0) {
        const prevPhase = workout.phases[curPos.phaseIdx - 1];
        const prevIsCircuit = prevPhase.circuit === true;
        const prevExercise = prevPhase.exercises[prevPhase.exercises.length - 1];
        setPos({
          phaseIdx: curPos.phaseIdx - 1,
          exerciseIdx: prevPhase.exercises.length - 1,
          setNum: prevIsCircuit ? 1 : prevExercise.sets,
          roundNum: prevIsCircuit ? (prevPhase.rounds ?? 1) : 1,
        });
      }
      setTimer(-1);
      setState("exercise");
      return;
    }

    if (curIsCircuit) {
      if (curPos.exerciseIdx > 0) {
        setPos((p) => ({ ...p, exerciseIdx: p.exerciseIdx - 1 }));
        setTimer(-1);
        setState("exercise");
        return;
      }
      if (curPos.roundNum > 1) {
        setPos((p) => ({
          ...p,
          exerciseIdx: curPhase.exercises.length - 1,
          roundNum: p.roundNum - 1,
        }));
        setTimer(-1);
        setState("exercise");
        return;
      }
      if (curPos.phaseIdx > 0) {
        const prevPhase = workout.phases[curPos.phaseIdx - 1];
        const prevIsCircuit = prevPhase.circuit === true;
        setPos({
          phaseIdx: curPos.phaseIdx - 1,
          exerciseIdx: prevPhase.exercises.length - 1,
          setNum: prevIsCircuit ? 1 : prevPhase.exercises[prevPhase.exercises.length - 1].sets,
          roundNum: prevIsCircuit ? (prevPhase.rounds ?? 1) : 1,
        });
        setTimer(-1);
        setState("exercise");
        return;
      }
      return;
    }

    // ─── Default mode ───
    if (curPos.setNum > 1) {
      setPos((p) => ({ ...p, setNum: p.setNum - 1 }));
      setTimer(-1);
      setState("exercise");
      return;
    }

    if (curPos.exerciseIdx > 0) {
      const prevExercise = curPhase.exercises[curPos.exerciseIdx - 1];
      setPos((p) => ({
        ...p,
        exerciseIdx: p.exerciseIdx - 1,
        setNum: prevExercise.sets,
      }));
      setTimer(-1);
      setState("exercise");
      return;
    }

    if (curPos.phaseIdx > 0) {
      const prevPhase = workout.phases[curPos.phaseIdx - 1];
      const prevIsCircuit = prevPhase.circuit === true;
      const prevExercise = prevPhase.exercises[prevPhase.exercises.length - 1];
      setPos({
        phaseIdx: curPos.phaseIdx - 1,
        exerciseIdx: prevPhase.exercises.length - 1,
        setNum: prevIsCircuit ? 1 : prevExercise.sets,
        roundNum: prevIsCircuit ? (prevPhase.rounds ?? 1) : 1,
      });
      setTimer(-1);
      setState("exercise");
      return;
    }
  }, [workout]);

  // ─── Skip: forward one logical step ─────────────────────────────────────
  const handleSkip = useCallback(() => {
    const curState = stateRef.current;

    if (curState === "rest") {
      advanceToNext();
      return;
    }
    if (curState === "prep") {
      setTimer(-1);
      setState("exercise");
      return;
    }
    if (curState === "phase_transition") {
      const curPos = posRef.current;
      const curPhase = workout.phases[curPos.phaseIdx];
      const firstEx = curPhase?.exercises[0];
      enterExercise(firstEx);
      return;
    }

    handleExerciseDone();
  }, [workout, advanceToNext, handleExerciseDone, enterExercise]);

  // ─── Skip entire optional exercise ──────────────────────────────────────
  const handleSkipOptional = useCallback(() => {
    const curPos = posRef.current;
    const curPhase = workout.phases[curPos.phaseIdx];
    const curIsCircuit = curPhase.circuit === true;
    const curRounds = curPhase.rounds ?? 1;
    const isLastExercise = curPos.exerciseIdx >= curPhase.exercises.length - 1;
    const isLastPhase = curPos.phaseIdx >= workout.phases.length - 1;

    if (curIsCircuit) {
      if (!isLastExercise) {
        const nextEx = curPhase.exercises[curPos.exerciseIdx + 1];
        setPos((p) => ({ ...p, exerciseIdx: p.exerciseIdx + 1 }));
        enterExercise(nextEx);
        return;
      }
      if (curPos.roundNum < curRounds) {
        setPos((p) => ({ ...p, exerciseIdx: 0, roundNum: p.roundNum + 1 }));
        enterExercise(curPhase.exercises[0]);
        return;
      }
    }

    if (isLastExercise && isLastPhase) {
      completeBeep();
      onComplete(totalElapsedRef.current);
      return;
    }

    if (isLastExercise) {
      const nextPhase = workout.phases[curPos.phaseIdx + 1];
      setPos({ phaseIdx: curPos.phaseIdx + 1, exerciseIdx: 0, setNum: 1, roundNum: 1 });
      if (nextPhase.transition_rest_secs && nextPhase.transition_rest_secs > 0) {
        setTimer(-1);
        setState("phase_transition");
      } else {
        enterExercise(nextPhase.exercises[0]);
      }
    } else {
      const nextEx = curPhase.exercises[curPos.exerciseIdx + 1];
      setPos((p) => ({ ...p, exerciseIdx: p.exerciseIdx + 1, setNum: 1 }));
      enterExercise(nextEx);
    }
  }, [workout, completeBeep, onComplete, enterExercise]);

  // ─── Skip entire optional phase ─────────────────────────────────────────
  const handleSkipPhase = useCallback(() => {
    const curPos = posRef.current;
    const isLastPhase = curPos.phaseIdx >= workout.phases.length - 1;

    if (isLastPhase) {
      completeBeep();
      onComplete(totalElapsedRef.current);
      return;
    }

    const nextPhase = workout.phases[curPos.phaseIdx + 1];
    setPos({ phaseIdx: curPos.phaseIdx + 1, exerciseIdx: 0, setNum: 1, roundNum: 1 });
    if (nextPhase.transition_rest_secs && nextPhase.transition_rest_secs > 0) {
      setTimer(-1);
      setState("phase_transition");
    } else {
      enterExercise(nextPhase.exercises[0]);
    }
  }, [workout, completeBeep, onComplete, enterExercise]);

  // ─── Timer init effect ───────────────────────────────────────────────────
  useEffect(() => {
    if (state === "phase_transition") {
      setTimer(phase?.transition_rest_secs ?? 0);
    } else if (state === "prep") {
      setTimer(exercise?.prep_secs ?? 0);
    } else if (state === "exercise" && exercise?.type === "timed") {
      setTimer(exercise.duration_secs ?? 0);
    } else if (state === "rest") {
      setTimer(getRestDuration());
    }
  }, [state, pos.phaseIdx, pos.exerciseIdx, pos.setNum, pos.roundNum, sideNum, exercise, phase, getRestDuration]);

  // ─── Countdown tick ──────────────────────────────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (state === "exercise" && exercise?.type === "reps") return;
    if (state !== "exercise" && state !== "rest" && state !== "prep" && state !== "phase_transition") return;
    if (timer < 0) return;

    if (timer === 0) {
      if (state === "exercise") {
        transitionBeep();
        handleExerciseDone();
      } else if (state === "rest") {
        transitionBeep();
        advanceToNext();
      } else if (state === "prep") {
        transitionBeep();
        setTimer(-1);
        setState("exercise");
      } else if (state === "phase_transition") {
        transitionBeep();
        const firstEx = phase?.exercises[0];
        enterExercise(firstEx);
      }
      return;
    }

    if (timer <= 3) {
      countdown3();
    }

    const interval = setInterval(() => {
      setTimer((t) => t - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [timer, isPaused, state, exercise, phase, transitionBeep, countdown3, handleExerciseDone, advanceToNext, enterExercise]);

  // ─── Derived display values ──────────────────────────────────────────────
  const isRest = state === "rest";
  const isPrep = state === "prep";
  const isPhaseTransition = state === "phase_transition";
  const isReps = state === "exercise" && exercise?.type === "reps";

  // Duration the current countdown started from — lets presentations render
  // a fill/progress indicator for the active state without re-deriving rest
  // rules themselves.
  const stateDuration = useMemo(() => {
    if (state === "phase_transition") return phase?.transition_rest_secs ?? 0;
    if (state === "prep") return exercise?.prep_secs ?? 0;
    if (state === "exercise" && exercise?.type === "timed") return exercise.duration_secs ?? 0;
    if (state === "rest") return getRestDuration();
    return 0;
  }, [state, phase, exercise, getRestDuration]);

  const nextPreview = ((): { label: string; name: string } | null => {
    if (!exercise || !phase) return null;

    if (isCircuit) {
      if (!isRest && pos.setNum < exercise.sets) {
        return { label: "Next Set", name: `${exercise.name} — Set ${pos.setNum + 1}` };
      }
      const isLastEx = pos.exerciseIdx >= phase.exercises.length - 1;
      if (!isLastEx) {
        return { label: "Next", name: phase.exercises[pos.exerciseIdx + 1].name };
      }
      if (pos.roundNum < phaseRounds) {
        return { label: `Round ${pos.roundNum + 1}`, name: phase.exercises[0].name };
      }
      if (pos.phaseIdx < workout.phases.length - 1) {
        const nextPhase = workout.phases[pos.phaseIdx + 1];
        return { label: nextPhase.name, name: nextPhase.exercises[0]?.name ?? "" };
      }
      return { label: "Done", name: "Final stretch!" };
    }

    if (pos.setNum < exercise.sets) {
      return { label: "Next Set", name: `${exercise.name} — Set ${pos.setNum + 1} of ${exercise.sets}` };
    }
    const nextEx =
      pos.exerciseIdx < phase.exercises.length - 1
        ? phase.exercises[pos.exerciseIdx + 1]
        : pos.phaseIdx < workout.phases.length - 1
          ? workout.phases[pos.phaseIdx + 1]?.exercises[0]
          : null;
    if (nextEx) return { label: "Up Next", name: nextEx.name };
    return { label: "Done", name: "Final stretch!" };
  })();

  return {
    state,
    pos,
    timer,
    stateDuration,
    isPaused,
    setIsPaused,
    muted,
    toggleMute,
    totalElapsed,
    progressPct,
    phase,
    exercise,
    isCircuit,
    phaseRounds,
    isRest,
    isPrep,
    isPhaseTransition,
    isReps,
    currentSide: sideNum,
    nextPreview,
    handleExerciseDone,
    handleGoBack,
    handleSkip,
    handleSkipOptional,
    handleSkipPhase,
  };
}
