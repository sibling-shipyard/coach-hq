import { CSSProperties, ReactNode } from "react";
import { Link } from "wouter";
import { Exercise, Phase, Workout, WorkoutType, formatTimer } from "@/lib/workouts";
import { tokens, workoutHex } from "@/lib/wiTokens";
import "@/components/home-warm/warm-instrument.css";
import "./workout-timer-warm.css";

// ─── Shared tokens ───────────────────────────────────────────────────────

export const WORKOUT_TYPE_ACCENT: Record<WorkoutType, string> = {
  foundation: workoutHex("foundation"),
  calisthenics: workoutHex("calisthenics"),
  recovery: workoutHex("recovery"),
  realign: workoutHex("realign"),
  strength: workoutHex("strength"),
};

const AMBER = workoutHex("realign");
const RUST = workoutHex("calisthenics");
const REST_ACCENT = tokens.palette.alarmFg;

export function accentFor(workoutType: WorkoutType): string {
  return WORKOUT_TYPE_ACCENT[workoutType] ?? RUST;
}

function doseFor(ex: Exercise): string {
  return ex.type === "timed" ? `${ex.sets}×${ex.duration_secs}s` : `${ex.sets}×${ex.reps}`;
}

// ─── Top bar ─────────────────────────────────────────────────────────────

export function TimerTopBar({
  backHref,
  onBack,
  title,
  sportLabel,
  sportAccent,
  right,
}: {
  backHref?: string;
  onBack?: () => void;
  title: string;
  sportLabel?: string;
  sportAccent?: string;
  right?: ReactNode;
}) {
  return (
    <div className="wtx-topbar">
      <div className="wtx-topbar__left">
        {onBack ? (
          <button type="button" className="wtx-back" aria-label="Back" onClick={onBack}>
            ←
          </button>
        ) : (
          <Link href={backHref ?? "/"} className="wtx-back" aria-label="Back">
            ←
          </Link>
        )}
        <span className="wtx-title">{title}</span>
        {sportLabel ? (
          <span
            className="wtx-sport-pill"
            style={{ "--sport-accent": sportAccent ?? RUST } as CSSProperties}
          >
            {sportLabel}
          </span>
        ) : null}
      </div>
      {right}
    </div>
  );
}

export function SportBadge({ label, accent }: { label: string; accent: string }) {
  return (
    <span className="wtx-sport-badge" style={{ background: accent }}>
      {label}
    </span>
  );
}

export function ElapsedReadout({ seconds }: { seconds: number }) {
  return (
    <div className="wtx-elapsed">
      <span className="wtx-elapsed__label">ELAPSED</span>
      <span className="wtx-elapsed__value">{formatTimer(seconds)}</span>
    </div>
  );
}

export function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`wtx-mute-btn ${muted ? "is-muted" : ""}`}
      onClick={onToggle}
      title={muted ? "MUTED" : "SOUND"}
      aria-label={muted ? "Unmute beeps" : "Mute beeps"}
      aria-pressed={muted}
    >
      {muted ? "♪̸" : "♪"}
    </button>
  );
}

export function TimerHeaderRight({
  muted,
  onToggleMute,
  seconds,
}: {
  muted: boolean;
  onToggleMute: () => void;
  seconds: number;
}) {
  return (
    <div className="wtx-header-right">
      <MuteButton muted={muted} onToggle={onToggleMute} />
      <ElapsedReadout seconds={seconds} />
    </div>
  );
}

// ─── Focus card (the live follow-along engine) ──────────────────────────

export interface FocusCardProps {
  blockLabel: string;
  exOfBlock: string;
  exNum: number;
  exTotal: number;
  exercise: Exercise;
  setLabel: string;
  optional?: boolean;
  screen: "exercise" | "prep" | "rest" | "phase_transition";
  timer: number;
  stateDuration: number;
  currentSide: 0 | 1;
  restCaption?: string;
  phaseTransitionName?: string;
  nextUp?: { name: string; dose: string };
  controls: {
    onPrev: () => void;
    onNext: () => void;
    primaryLabel: string;
    onPrimary: () => void;
  };
}

function readoutColor(screen: FocusCardProps["screen"]): string {
  if (screen === "prep") return AMBER;
  if (screen === "rest" || screen === "phase_transition") return REST_ACCENT;
  return RUST;
}

export function FocusCard(props: FocusCardProps) {
  const {
    blockLabel,
    exOfBlock,
    exNum,
    exTotal,
    exercise,
    setLabel,
    optional,
    screen,
    timer,
    stateDuration,
    currentSide,
    restCaption,
    phaseTransitionName,
    nextUp,
    controls,
  } = props;

  const isReps = screen === "exercise" && exercise.type === "reps";
  const bothSides = exercise.both_sides && exercise.type === "timed" && screen === "exercise";
  const color = readoutColor(screen);
  const pct = !isReps && stateDuration > 0
    ? Math.max(0, Math.min(1, 1 - timer / stateDuration))
    : null;

  const caption = (() => {
    if (screen === "phase_transition") return `NEXT BLOCK — ${phaseTransitionName ?? ""}`;
    if (screen === "prep") return "GET READY — GET INTO POSITION";
    if (screen === "rest") return restCaption ?? "REST — NEXT SET AUTO-STARTS";
    if (isReps) return "REPS — TAP DONE WHEN FINISHED";
    if (bothSides) return currentSide === 0 ? "LEFT SIDE — HOLD" : "RIGHT SIDE — HOLD";
    return "COUNTDOWN — AUTO-ADVANCES AT 0";
  })();

  return (
    <div className="wtx-focus-card">
      <div className="wtx-focus-card__top">
        <div className="wtx-focus-card__top-left">
          <span className="wtx-block-pill">{blockLabel}</span>
          <span className="wtx-of-block">{exOfBlock}</span>
        </div>
        <span className="wtx-ex-total">
          EXERCISE {exNum} / {exTotal}
        </span>
      </div>

      <div className="wtx-exercise-meta">
        <span className="wtx-exercise-meta__num">#{exNum}</span>
        <div className="wtx-exercise-meta__name">
          {screen === "rest" ? "Rest" : screen === "phase_transition" ? phaseTransitionName ?? "Up next" : exercise.name}
          {optional && screen === "exercise" ? (
            <span className="wtx-exercise-meta__optional">OPTIONAL</span>
          ) : null}
        </div>
        <span className="wtx-exercise-meta__set">{setLabel}</span>
      </div>

      {bothSides ? (
        <div className="wtx-sides">
          <span className={`wtx-side-pill ${currentSide === 0 ? "is-active" : ""}`}>LEFT</span>
          <span className={`wtx-side-pill ${currentSide === 1 ? "is-active" : ""}`}>RIGHT</span>
        </div>
      ) : null}

      {isReps ? (
        <div className="wtx-reps-readout">
          <span className="wtx-reps-readout__value">×{exercise.reps}</span>
          <span className="wtx-reps-readout__label">{exercise.reps === 1 ? "REP" : "REPS"}</span>
          <span className="wtx-countdown-caption">{caption}</span>
        </div>
      ) : (
        <div className="wtx-countdown-wrap">
          <div className="wtx-countdown" style={{ color }}>
            {formatTimer(Math.max(0, timer))}
          </div>
          {pct !== null ? (
            <div className="wtx-progress-track">
              <span style={{ width: `${Math.round(pct * 100)}%`, background: color }} />
            </div>
          ) : null}
          <div className="wtx-countdown-caption">{caption}</div>
        </div>
      )}

      {screen === "exercise" || screen === "prep" ? (
        <div className="wtx-info-grid">
          <div className="wtx-cue-card">
            <span className="wtx-cue-card__label">FORM CUE</span>
            <span className="wtx-cue-card__body">{exercise.form_cue}</span>
          </div>
          <div className="wtx-why-card">
            <span className="wtx-why-card__label">WHY — COACH</span>
            <span className="wtx-why-card__body">{exercise.why}</span>
          </div>
        </div>
      ) : null}

      {nextUp ? (
        <div className="wtx-mobile-next">
          <span className="wtx-mobile-next__label">NEXT</span>
          <span className="wtx-mobile-next__name">{nextUp.name}</span>
          <span className="wtx-mobile-next__dose">{nextUp.dose}</span>
        </div>
      ) : null}

      <TimerControlRow
        onPrev={controls.onPrev}
        onNext={controls.onNext}
        primaryLabel={controls.primaryLabel}
        onPrimary={controls.onPrimary}
      />
    </div>
  );
}

// ─── Controls row ────────────────────────────────────────────────────────

export function TimerControlRow({
  onPrev,
  onNext,
  primaryLabel,
  onPrimary,
  prevDisabled,
}: {
  onPrev: () => void;
  onNext: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  prevDisabled?: boolean;
}) {
  return (
    <div className="wtx-controls">
      <button
        type="button"
        className="wtx-control-btn"
        onClick={onPrev}
        disabled={prevDisabled}
        aria-label="Previous"
      >
        ⏮
      </button>
      <button type="button" className="wtx-primary-btn" onClick={onPrimary}>
        {primaryLabel}
      </button>
      <button type="button" className="wtx-control-btn" onClick={onNext} aria-label="Next">
        ⏭
      </button>
    </div>
  );
}

// ─── Right rail ──────────────────────────────────────────────────────────

export interface UpNextRow {
  n: number;
  name: string;
  block: string;
  dose: string;
}

export function UpNextCard({ rows }: { rows: UpNextRow[] }) {
  return (
    <div className="wtx-uplist-card">
      <span className="wtx-note-card__label">UP NEXT</span>
      {rows.length === 0 ? (
        <span className="wtx-uplist-empty">Final stretch — nothing after this.</span>
      ) : (
        rows.map((row) => (
          <div className="wtx-uplist-row" key={`${row.n}-${row.name}`}>
            <span className="wtx-uplist-row__n">{row.n}</span>
            <div className="wtx-uplist-row__body">
              <span className="wtx-uplist-row__name">{row.name}</span>
              <span className="wtx-uplist-row__block">{row.block}</span>
            </div>
            <span className="wtx-uplist-row__dose">{row.dose}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function deriveBlockTags(workout: Workout, max = 4): { tags: string[]; overflow: number } {
  const seen: string[] = [];
  workout.phases.forEach((phase) => {
    const tag = phase.name.split(" — ")[0].trim();
    if (!seen.includes(tag)) seen.push(tag);
  });
  return { tags: seen.slice(0, max), overflow: Math.max(0, seen.length - max) };
}

export function SessionNoteCard({ note }: { note: string }) {
  return (
    <div className="wtx-note-card">
      <span className="wtx-note-card__label">SESSION</span>
      <span className="wtx-note-card__body">{note} — Coach</span>
    </div>
  );
}

// ─── Shared data helpers ─────────────────────────────────────────────────

export function buildUpNext(workout: Workout, phaseIdx: number, exerciseIdx: number, count = 4): UpNextRow[] {
  const flat: { phase: Phase; exercise: Exercise }[] = [];
  workout.phases.forEach((phase) => {
    phase.exercises.forEach((exercise) => {
      flat.push({ phase, exercise });
    });
  });
  const currentFlatIdx = flat.findIndex(
    (entry) => entry.exercise.num === workout.phases[phaseIdx]?.exercises[exerciseIdx]?.num,
  );
  if (currentFlatIdx < 0) return [];
  return flat.slice(currentFlatIdx + 1, currentFlatIdx + 1 + count).map(({ phase, exercise }) => ({
    n: exercise.num,
    name: exercise.name,
    block: phase.circuit ? `${phase.name} · ${phase.rounds ?? 1}×` : phase.name,
    dose: doseFor(exercise),
  }));
}

export { doseFor };
