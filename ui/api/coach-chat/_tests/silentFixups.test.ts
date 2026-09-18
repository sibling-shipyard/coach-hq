import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureServerMessage } = vi.hoisted(() => ({
  captureServerMessage: vi.fn(async () => ({ sent: true })),
}));
vi.mock("../../_lib/sentry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/sentry.js")>();
  return { ...original, captureServerMessage };
});

import { applySessionPlan, applyTemplateEdit } from "../_lib/decide/coachWorkoutFiles.js";
import { flushSilentFixups, recordSilentFixup } from "../_lib/decide/silentFixups.js";

// A skip_phases name that matches nothing (or two phases) is corrected server-side with no
// signal to the athlete. These pin that every such path reaches Sentry once per turn.

const ex = (num: number) => ({
  num,
  name: `Exercise ${num}`,
  type: "reps" as const,
  reps: 10,
  sets: 3,
  form_cue: "Form.",
  why: "Why.",
});
const template = JSON.stringify({
  id: "strength_b",
  title: "Strength B",
  subtitle: "Upper",
  workout_type: "strength",
  estimated_duration_mins: 45,
  location: "gym",
  equipment: [],
  coaching_note: "Note.",
  phases: [
    { name: "Warmup", duration: "5 min", default_rest_secs: 30, exercises: [ex(1)] },
    { name: "Main set A", duration: "10 min", default_rest_secs: 30, exercises: [ex(2)] },
    { name: "Main set B", duration: "10 min", default_rest_secs: 30, exercises: [ex(3)] },
  ],
});
const validIds = new Set(["strength_b"]);

describe("silent fixups reach Sentry", () => {
  beforeEach(() => {
    captureServerMessage.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reports an unmatched session_plan phase once per turn", async () => {
    applySessionPlan(
      template,
      { template_id: "strength_b", session_date: "2026-08-18", skip_phases: ["core"] },
      validIds,
      "trace-a",
    );
    await flushSilentFixups("trace-a");
    await flushSilentFixups("trace-a");

    expect(captureServerMessage).toHaveBeenCalledTimes(1);
    expect(captureServerMessage).toHaveBeenCalledWith(
      expect.stringContaining("phase_no_match"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ vercel_trace_id: "trace-a" }),
        contexts: {
          coach_turn: {
            fixups: [{ kind: "phase_no_match", action: "session_plan", detail: "core" }],
          },
        },
      }),
    );
  });

  it("reports an ambiguous template_edit phase with the action named", async () => {
    applyTemplateEdit(
      template,
      { template_id: "strength_b", skip_phases: ["main"] },
      validIds,
      "trace-b",
    );
    await flushSilentFixups("trace-b");

    expect(captureServerMessage).toHaveBeenCalledWith(
      expect.stringContaining("phase_ambiguous"),
      expect.objectContaining({
        contexts: {
          coach_turn: {
            fixups: [{ kind: "phase_ambiguous", action: "template_edit", detail: "main" }],
          },
        },
      }),
    );
  });

  it("sends nothing when the turn recorded no fixups or has no trace id", async () => {
    await flushSilentFixups("trace-none");
    recordSilentFixup(undefined, { kind: "phase_no_match", action: "session_plan", detail: "x" });
    await flushSilentFixups(undefined);

    expect(captureServerMessage).not.toHaveBeenCalled();
  });

  it("groups several fixups from one turn into a single message", async () => {
    recordSilentFixup("trace-c", {
      kind: "template_id_nulled",
      action: "week_update",
      detail: "x",
    });
    recordSilentFixup("trace-c", {
      kind: "discipline_coerced",
      action: "week_update",
      detail: "yoga",
    });
    await flushSilentFixups("trace-c");

    expect(captureServerMessage).toHaveBeenCalledTimes(1);
  });
});
