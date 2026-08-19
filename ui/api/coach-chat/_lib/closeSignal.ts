/**
 * Deterministic close-intent detection for coach-chat. Deliberately a simple keyword match, not
 * asking Gemini to self-detect intent - the whole point is one reliable trigger for the close-out
 * turn instead of hoping the model notices a session-ending signal buried in a 370-line SOUL.md
 * dump on its own. False negatives just mean the athlete has to say it more plainly; false
 * positives are cheap (worst case, an extra real save).
 */
import type { ChatMessage } from "./chatThreads.js";

// Bare "wrap" is anchored to the whole (trimmed) message, not just the last word - an
// unanchored match false-fires on "I don't think we should wrap" (negated, not a close signal).
// A short affirming filler ("let's"/"ok"/"yeah wrap") is allowed in front since real athletes
// type it that way; "done" alone is deliberately excluded ("done for today's hill reps" isn't a
// close). "that's it/all" is anchored to the end of the message so "that's all, actually one
// more thing" doesn't false-positive.
// Found live during First Session Protocol testing: "let's wrap this up" - an extremely common,
// completely natural close phrase - didn't match, since the filler alternation between "wrap"
// and "up" only allowed "it "/"things ", not "this ". Gemini itself decided to close that turn
// (session_closed: true) but the server discarded it because closeIntent gated the whole close
// path and was false - a real athlete-facing bug, not just a missed edge case.
const CLOSE_SESSION_PATTERN =
  /\b(wrap|close|end)\b[\s\w]*\bsession\b|\bwrap(ping)? (it |this |things )?up\b|^(let'?s|ok|okay|yeah|yep|alright|sure)?[,.]?\s*wrap[.!]?$|done for (today|the day)|that'?s (it|all|everything)\b(\s+for (today|now|me))?[.!]?$|goodnight coach|\bbye coach\b|\bsee you tomorrow\b|\bcatch you later\b/i;

export function isCloseSignal(message: string): boolean {
  return CLOSE_SESSION_PATTERN.test(message);
}

// Answering Coach's own clarifying close-question ("8hrs" to "how'd you sleep?") never matches
// CLOSE_SESSION_PATTERN on its own, so the trigger needs to remember a pending close instead of
// trusting Gemini to self-regulate a second time (it's been observed claiming session_closed:
// true on an "ordinary" turn otherwise). Bounded to a few messages so an abandoned close attempt
// doesn't leak into unrelated later chat in the same thread.
const CLOSE_ATTEMPT_LOOKBACK = 4;

export function wasCloseAttemptPending(priorMessages: ChatMessage[]): boolean {
  return priorMessages.slice(-CLOSE_ATTEMPT_LOOKBACK).some((m) => m.role === "user" && isCloseSignal(m.text));
}

export function shouldRequestClose(
  message: string,
  priorMessages: ChatMessage[],
  endConversationRequested = false,
): boolean {
  return endConversationRequested || isCloseSignal(message) || wasCloseAttemptPending(priorMessages);
}

export function acceptedMessage(message: string | undefined, endConversationRequested = false): string | null {
  const trimmed = (message ?? "").trim();
  return trimmed || endConversationRequested ? trimmed : null;
}

// Gemini requires each request to end with a user turn. The explicit button has no athlete text,
// so give the model a control event while keeping it out of the visible/committed transcript.
export function messageForGemini(message: string, endConversationRequested = false): string {
  return message || (endConversationRequested ? "[The athlete pressed End Conversation.]" : message);
}
