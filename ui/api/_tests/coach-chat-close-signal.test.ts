import { describe, it, expect } from "vitest";
import { isCloseSignal } from "../coach-chat.js";

// A8: CLOSE_SESSION_PATTERN originally required "session" after wrap/close/end, so a bare "wrap"
// never routed into closing mode at all - the athlete typed it in production and got an ordinary
// turn that hallucinated closing-sounding language instead of an actual close-out. Broadened to
// catch casual bare sign-offs. Regex-level false positives (e.g. "done for today's hill reps")
// are an accepted tradeoff by design (see CLOSE_SESSION_PATTERN's comment) - guarded downstream
// by Gemini's own closing-turn judgment, covered separately by the
// false-positive-close-signal eval transcript, not by this regex-routing test.
describe("isCloseSignal", () => {
  it("matches a bare 'wrap'", () => {
    expect(isCloseSignal("wrap")).toBe(true);
  });

  it("matches 'wrap' with trailing punctuation", () => {
    expect(isCloseSignal("wrap.")).toBe(true);
    expect(isCloseSignal("wrap!")).toBe(true);
  });

  it("still matches the original 'wrap session' phrasing", () => {
    expect(isCloseSignal("wrap session")).toBe(true);
  });

  it("matches 'wrapping up for today'", () => {
    expect(isCloseSignal("wrapping up for today")).toBe(true);
  });

  it("matches 'that's it for me' without a trailing 'for today/now'", () => {
    expect(isCloseSignal("that's it for me")).toBe(true);
  });

  it("does not match an ordinary training message with no sign-off language", () => {
    expect(isCloseSignal("felt strong on the intervals today, HR stayed under 160")).toBe(false);
  });
});
