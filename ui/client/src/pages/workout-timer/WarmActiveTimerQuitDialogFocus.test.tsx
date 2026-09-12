// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { Workout } from "@/lib/workouts";
import type { UseTimerEngineReturn } from "./useTimerEngine";

// Regression test for the quit-workout dialog's focus management, flagged and deferred across
// #958-#965 as "genuinely behavioral, not verifiable from source alone." Mocking the timer
// engine keeps this test independent of its internal tick/phase logic - it only exercises the
// dialog's own open/close focus behavior.
const engine: UseTimerEngineReturn = {
  state: "exercise",
  pos: { phaseIdx: 0, exerciseIdx: 0, setNum: 1, roundNum: 1 },
  timer: 0,
  stateDuration: 0,
  isPaused: false,
  setIsPaused: vi.fn(),
  muted: false,
  toggleMute: vi.fn(),
  totalElapsed: 0,
  progressPct: 0,
  phase: {
    name: "Warmup",
    duration: "5m",
    default_rest_secs: 30,
    exercises: [{ num: 1, name: "Push-ups", type: "reps", sets: 1, form_cue: "", why: "" }],
  },
  exercise: { num: 1, name: "Push-ups", type: "reps", sets: 1, form_cue: "", why: "" },
  isCircuit: false,
  phaseRounds: 1,
  isRest: false,
  isPrep: false,
  isPhaseTransition: false,
  isReps: true,
  currentSide: undefined,
  handleExerciseDone: vi.fn(),
  handleGoBack: vi.fn(),
  handleSkip: vi.fn(),
  handleSkipOptional: vi.fn(),
  handleSkipPhase: vi.fn(),
} as unknown as UseTimerEngineReturn;

vi.mock("./useTimerEngine", () => ({
  useTimerEngine: () => engine,
}));

const workout: Workout = {
  id: "w1",
  title: "Test Workout",
  subtitle: "",
  workout_type: "strength",
  estimated_duration_mins: 10,
  location: "",
  equipment: [],
  coaching_note: "",
  phases: [engine.phase!],
};

async function renderTimer() {
  const { WarmActiveTimer } = await import("./WarmActiveTimer");
  return render(<WarmActiveTimer workout={workout} onComplete={() => {}} onQuit={() => {}} />);
}

describe("WarmActiveTimer quit dialog focus management", () => {
  afterEach(cleanup);

  it("moves focus into the dialog on open, traps Tab, and returns focus to Back on close", async () => {
    await renderTimer();
    const backButton = screen.getByRole("button", { name: "Back" });
    backButton.focus();
    fireEvent.click(backButton);

    const continueButton = screen.getByRole("button", { name: "Continue" });
    const quitButton = screen.getByRole("button", { name: "Quit" });
    expect(continueButton).toHaveFocus();

    // Shift+Tab from the first control wraps to the last, trapping focus in the dialog.
    fireEvent.keyDown(window, { code: "Tab", shiftKey: true });
    expect(quitButton).toHaveFocus();

    fireEvent.click(continueButton);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backButton).toHaveFocus();
  });

  it("closes on Escape and returns focus to Back", async () => {
    await renderTimer();
    const backButton = screen.getByRole("button", { name: "Back" });
    backButton.focus();
    fireEvent.click(backButton);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { code: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backButton).toHaveFocus();
  });
});
