import { describe, it, expect } from "vitest";
import { resolveFileUpdate } from "../coach-chat.js";

// A7's dispatch logic: which write strategy applies to which file, and what makes an update
// get dropped instead of committed. Doesn't exercise the HTTP handler (auth, Gemini, GitHub
// commits) - just the pure resolve step, same as fileEdits.test.ts covers the strategies
// themselves.
// MVP (coach-commit-mvp.md): every drop now returns { ok: false, path, reason } instead of a
// bare null, so these tests assert on the actual reason string, not just "it was falsy".
describe("resolveFileUpdate", () => {
  it("applies edits to a markdown file (state.md) against its current content", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/state.md", edits: [{ old_string: "old line", new_string: "new line" }] },
      "old line\nother stuff",
    );
    expect(result).toEqual({ ok: true, path: "user_data/coach/state.md", content: "new line\nother stuff" });
  });

  it("drops a markdown update with no edits array", () => {
    const result = resolveFileUpdate({ path: "user_data/coach/state.md" }, "content");
    expect(result).toEqual({ ok: false, path: "user_data/coach/state.md", reason: "markdown update with no edits array" });
  });

  it("drops a markdown update whose only edit fails to match", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/state.md", edits: [{ old_string: "not present", new_string: "x" }] },
      "totally different content",
    );
    expect(result).toEqual({
      ok: false,
      path: "user_data/coach/state.md",
      reason: "all edits failed to match - no-op, not committed",
    });
  });

  it("drops a markdown update whose edits would wipe the file blank", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/state.md", edits: [{ old_string: "only content here", new_string: "" }] },
      "only content here",
    );
    expect(result).toEqual({
      ok: false,
      path: "user_data/coach/state.md",
      reason: "result would be blank - refusing to wipe the file",
    });
  });

  it("applies a merge patch to a JSON file (challenge_v2.json) against its current content", () => {
    const result = resolveFileUpdate(
      { path: "user_data/ledger/challenge_v2.json", merge_patch: '{"phase":"peak"}' },
      '{"phase":"base","other":1}',
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse((result as { ok: true; content: string }).content)).toEqual({ phase: "peak", other: 1 });
  });

  it("drops a JSON update with no merge_patch", () => {
    const result = resolveFileUpdate({ path: "user_data/ledger/challenge_v2.json" }, "{}");
    expect(result).toEqual({ ok: false, path: "user_data/ledger/challenge_v2.json", reason: "JSON update with no merge_patch" });
  });

  it("drops a JSON update whose merge_patch is invalid JSON", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/sleep_log.json", merge_patch: "{not valid" },
      "{}",
    );
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/^merge patch rejected - /);
  });

  it("keeps full-content replacement for session files", () => {
    const result = resolveFileUpdate(
      { path: "user_data/activities/workout_plans/sessions/2026-08-02.json", content: '{"logged":true}' },
      null,
    );
    expect(result).toEqual({
      ok: true,
      path: "user_data/activities/workout_plans/sessions/2026-08-02.json",
      content: '{"logged":true}',
    });
  });

  it("drops a session file update with blank content", () => {
    const result = resolveFileUpdate(
      { path: "user_data/activities/workout_plans/sessions/2026-08-02.json", content: "   " },
      null,
    );
    expect(result).toEqual({
      ok: false,
      path: "user_data/activities/workout_plans/sessions/2026-08-02.json",
      reason: "session file update with blank content",
    });
  });

  it("drops any path outside the coach-writable allowlist regardless of what's proposed", () => {
    const result = resolveFileUpdate(
      { path: "propagated/SOUL.md", content: "malicious rewrite" },
      "original soul content",
    );
    expect(result).toEqual({ ok: false, path: "propagated/SOUL.md", reason: "path is not coach-writable" });
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
    expect(result).toEqual({
      ok: false,
      path: "user_data/ledger/challenge_v2.json",
      reason: "proposed without its current content having been fetched this turn",
    });
  });

  it("still allows a JSON merge_patch when the file was fetched and genuinely doesn't exist yet (null)", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/sleep_log.json", merge_patch: '{"hours":7.5}' },
      null,
    );
    expect(result.ok).toBe(true);
    expect(JSON.parse((result as { ok: true; content: string }).content)).toEqual({ hours: 7.5 });
  });

  it("drops a markdown edit proposed when the current content was never fetched this turn (undefined, not null)", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/state.md", edits: [{ old_string: "x", new_string: "y" }] },
      undefined,
    );
    expect(result).toEqual({
      ok: false,
      path: "user_data/coach/state.md",
      reason: "proposed without its current content having been fetched this turn",
    });
  });

  // coach-commit-mvp: coach_notes.md is no longer an edits-eligible markdown target (Gemini
  // reports coach_note instead) - it now hits the same "not coach-writable" rejection as any
  // other retired/disallowed path, same mechanism already covered above for propagated/SOUL.md.
  it("drops a markdown edit proposed for the retired coach_notes.md path, regardless of content", () => {
    const result = resolveFileUpdate(
      { path: "user_data/coach/coach_notes.md", edits: [{ old_string: "x", new_string: "y" }] },
      "some content",
    );
    expect(result).toEqual({ ok: false, path: "user_data/coach/coach_notes.md", reason: "path is not coach-writable" });
  });

  it("session files ignore currentContent entirely, even when undefined", () => {
    const result = resolveFileUpdate(
      { path: "user_data/activities/workout_plans/sessions/2026-08-02.json", content: '{"logged":true}' },
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      path: "user_data/activities/workout_plans/sessions/2026-08-02.json",
      content: '{"logged":true}',
    });
  });
});
