import { describe, it, expect } from "vitest";
import { resolveFileUpdate } from "../coach-chat.js";

// A7's dispatch logic: which write strategy applies to which file, and what makes an update
// get dropped instead of committed. Doesn't exercise the HTTP handler (auth, Gemini, GitHub
// commits) - just the pure resolve step, same as fileEdits.test.ts covers the strategies
// themselves.
describe("resolveFileUpdate", () => {
  it("applies edits to a markdown file (state.md) against its current content", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/state.md", edits: [{ old_string: "old line", new_string: "new line" }] },
      "old line\nother stuff",
    );
    expect(result).toEqual({ path: "user_data/coach/state.md", content: "new line\nother stuff" });
  });

  it("drops a markdown update with no edits array", () => {
    const result = resolveFileUpdate({ path: "user_data/coach/state.md" }, "content");
    expect(result).toBeNull();
  });

  it("drops a markdown update whose only edit fails to match", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/coach_notes.md", edits: [{ old_string: "not present", new_string: "x" }] },
      "totally different content",
    );
    expect(result).toBeNull();
  });

  it("applies a merge patch to a JSON file (challenge_v2.json) against its current content", () => {
    const result = resolveFileUpdate(
      { path: "user_data/ledger/challenge_v2.json", merge_patch: '{"phase":"peak"}' },
      '{"phase":"base","other":1}',
    );
    expect(result).not.toBeNull();
    expect(JSON.parse(result!.content)).toEqual({ phase: "peak", other: 1 });
  });

  it("drops a JSON update with no merge_patch", () => {
    const result = resolveFileUpdate({ path: "user_data/ledger/challenge_v2.json" }, "{}");
    expect(result).toBeNull();
  });

  it("drops a JSON update whose merge_patch is invalid JSON", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/sleep_log.json", merge_patch: "{not valid" },
      "{}",
    );
    expect(result).toBeNull();
  });

  it("keeps full-content replacement for session files", () => {
    const result = resolveFileUpdate(
      { path: "user_data/activities/workout_plans/sessions/2026-08-02.json", content: '{"logged":true}' },
      null,
    );
    expect(result).toEqual({
      path: "user_data/activities/workout_plans/sessions/2026-08-02.json",
      content: '{"logged":true}',
    });
  });

  it("drops a session file update with blank content", () => {
    const result = resolveFileUpdate(
      { path: "user_data/activities/workout_plans/sessions/2026-08-02.json", content: "   " },
      null,
    );
    expect(result).toBeNull();
  });

  it("drops any path outside the coach-writable allowlist regardless of what's proposed", () => {
    const result = resolveFileUpdate(
      { path: "propagated/SOUL.md", content: "malicious rewrite" },
      "original soul content",
    );
    expect(result).toBeNull();
  });

  // Audit fix: currentContent === undefined means "not fetched this turn at all" (e.g. an
  // ordinary turn never fetches challenge_v2.json), distinct from null ("fetched, file doesn't
  // exist yet"). A merge_patch/edits proposal against unfetched content must be rejected, not
  // silently applied against an assumed-empty file.
  it("drops a JSON merge_patch proposed when the current content was never fetched this turn (undefined, not null)", () => {
    const result = resolveFileUpdate(
      { path: "user_data/ledger/challenge_v2.json", merge_patch: '{"phase":"peak"}' },
      undefined,
    );
    expect(result).toBeNull();
  });

  it("still allows a JSON merge_patch when the file was fetched and genuinely doesn't exist yet (null)", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/sleep_log.json", merge_patch: '{"hours":7.5}' },
      null,
    );
    expect(result).not.toBeNull();
    expect(JSON.parse(result!.content)).toEqual({ hours: 7.5 });
  });

  it("drops a markdown edit proposed when the current content was never fetched this turn (undefined, not null)", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/coach_notes.md", edits: [{ old_string: "x", new_string: "y" }] },
      undefined,
    );
    expect(result).toBeNull();
  });

  it("session files ignore currentContent entirely, even when undefined", () => {
    const result = resolveFileUpdate(
      { path: "user_data/activities/workout_plans/sessions/2026-08-02.json", content: '{"logged":true}' },
      undefined,
    );
    expect(result).toEqual({
      path: "user_data/activities/workout_plans/sessions/2026-08-02.json",
      content: '{"logged":true}',
    });
  });
});
