import { describe, it, expect } from "vitest";
import { isCloseSignal, wasCloseAttemptPending } from "../coach-chat.js";
import type { ChatMessage } from "../coach-chat.js";

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

  it("matches 'that's it for me' (end-of-message sign-off)", () => {
    expect(isCloseSignal("that's it for me")).toBe(true);
  });

  it("matches 'that's all for now' and bare 'that's it.' at end of message", () => {
    expect(isCloseSignal("that's all for now")).toBe(true);
    expect(isCloseSignal("that's it.")).toBe(true);
  });

  it("does not match 'that's it/all' when more content follows it in the message", () => {
    expect(isCloseSignal("that's all, actually one more thing about my shoulder")).toBe(false);
    expect(isCloseSignal("that's it - also, how's the taper looking for next week?")).toBe(false);
  });

  it("does not match an ordinary training message with no sign-off language", () => {
    expect(isCloseSignal("felt strong on the intervals today, HR stayed under 160")).toBe(false);
  });

  it("does not match a negated 'wrap' buried in a longer sentence", () => {
    expect(isCloseSignal("I don't think we should wrap")).toBe(false);
    expect(isCloseSignal("I dont think we should wrap")).toBe(false);
  });

  // A9: found via real testing - "Lets wrap" is completely normal phrasing that the whole-message
  // anchor above accidentally excluded, since it required the message to be ONLY "wrap".
  it("matches 'wrap' with a short closing-affirming filler in front", () => {
    expect(isCloseSignal("Lets wrap")).toBe(true);
    expect(isCloseSignal("let's wrap")).toBe(true);
    expect(isCloseSignal("ok wrap")).toBe(true);
    expect(isCloseSignal("yeah, wrap")).toBe(true);
  });
});

// A10: live testing found that answering Coach's own clarifying close-question ("how'd you
// sleep?") with a normal reply like "sleep 8hrs" never re-triggers CLOSE_SESSION_PATTERN on its
// own, which routed the turn as ordinary - and Gemini was observed returning session_closed: true
// anyway, in violation of the ordinary-turn prompt, producing a convincing "saved" message for a
// turn that committed nothing. wasCloseAttemptPending bridges that gap deterministically.
describe("wasCloseAttemptPending", () => {
  const user = (text: string): ChatMessage => ({ id: "u", role: "user", text });
  const coach = (text: string): ChatMessage => ({ id: "c", role: "coach", paragraphs: [text] });

  it("is true right after the athlete said a close-trigger phrase", () => {
    const history: ChatMessage[] = [user("wrap"), coach("Before I close - how'd you sleep?")];
    expect(wasCloseAttemptPending(history)).toBe(true);
  });

  it("is false with no close-trigger phrase anywhere in the recent window", () => {
    const history: ChatMessage[] = [user("felt strong today"), coach("Nice work.")];
    expect(wasCloseAttemptPending(history)).toBe(false);
  });

  it("is false on an empty or brand-new conversation", () => {
    expect(wasCloseAttemptPending([])).toBe(false);
  });

  it("only looks at the last few messages, not the whole thread", () => {
    const history: ChatMessage[] = [
      user("wrap"),
      coach("Before I close - how'd you sleep?"),
      user("actually never mind, quick question about my knee"),
      coach("Sure, what's up?"),
      user("does the swelling look normal to you"),
      coach("Hard to say without seeing it - worth a doctor's opinion if it doesn't settle."),
    ];
    expect(wasCloseAttemptPending(history)).toBe(false);
  });
});
