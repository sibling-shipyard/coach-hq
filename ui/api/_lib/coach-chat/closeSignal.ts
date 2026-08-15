/**
 * Deterministic close-intent detection for coach-chat. Deliberately a simple keyword match, not
 * asking Gemini to self-detect intent - the whole point is one reliable trigger for the close-out
 * turn instead of hoping the model notices a session-ending signal buried in a 370-line SOUL.md
 * dump on its own. False negatives just mean the athlete has to say it more plainly; false
 * positives are cheap (worst case, an extra real save).
 */
import type { ChatMessage } from "./chatThreads.js";

// A6: added a few more natural sign-offs the athlete actually said in testing ("bye coach",
// "that's all for now", "see you tomorrow", "catch you later") alongside the original set.
// A8: the original pattern missed bare casual sign-offs an athlete actually typed in production
// ("wrap" alone, with no trailing "session") - broadened to catch "wrap"/"wrapping up" without
// requiring "session". Bare "done" is deliberately still excluded - "done for today's hill reps"
// must not falsely trigger a close.
// Bare "wrap" requires the WHOLE (trimmed) message to be just "wrap" plus optional punctuation
// (^wrap[.!]?$), not merely the last word of any message - an unanchored end-of-string match
// spuriously fired on sentences like "I don't think we should wrap", where "wrap" is negated,
// not a close signal. Detecting negation itself isn't worth the regex complexity (fights this
// pattern's own "deliberately simple keyword match" design above) - restricting to short,
// standalone "wrap"-only messages sidesteps it entirely, since that's how athletes actually type
// this sign-off in practice.
// "that's it"/"that's all" is anchored to the end of the message (optionally followed by a short
// "for today/now/me" and trailing punctuation) rather than matching anywhere - an unanchored
// version would false-positive on "that's all, actually one more thing about my shoulder", where
// the athlete is clearly still talking, not closing.
// A9: real-world testing found "Lets wrap" - completely normal phrasing - didn't match the bare
// "wrap" anchor, since that was tightened to require the ENTIRE message be just "wrap" (to stop
// "I don't think we should wrap" from false-triggering). That fix was too strict: it also
// excluded "let's wrap"/"ok wrap"/"yeah, wrap", real closing phrases with a short filler in front.
// Widened to allow a short closing-affirming filler before "wrap" while still anchoring to the
// end of the message - a real sentence like "I don't think we should wrap" still doesn't fit this
// shape (too many words, no affirming filler), so that negation case still correctly excludes.
const CLOSE_SESSION_PATTERN =
  /\b(wrap|close|end)\b[\s\w]*\bsession\b|\bwrap(ping)? (it |things )?up\b|^(let'?s|ok|okay|yeah|yep|alright|sure)?[,.]?\s*wrap[.!]?$|done for (today|the day)|that'?s (it|all)\b(\s+for (today|now|me))?[.!]?$|goodnight coach|\bbye coach\b|\bsee you tomorrow\b|\bcatch you later\b/i;

export function isCloseSignal(message: string): boolean {
  return CLOSE_SESSION_PATTERN.test(message);
}

// A10: live testing found a bigger gap than the regex itself - a closing turn that asks a
// clarifying question ("before I close, how'd you sleep?") gets a completely ordinary-sounding
// reply back ("sleep 8hrs"), which never matches CLOSE_SESSION_PATTERN on its own. That routes
// the next turn as "ordinary" - and Gemini, in direct violation of the ordinary-turn prompt's own
// "set session_closed to false" instruction, was observed returning session_closed: true and a
// fully closing-style reply anyway. Since `closing` requires closeIntent to be true regardless of
// what Gemini says, nothing actually got committed - but the athlete saw a convincing "all set,
// logged" message for a turn that saved nothing at all. Prompt-only fixes for Gemini not
// following its own instructions have already proven unreliable elsewhere in this codebase's
// history (see docs/eng-docs/coach-chat-design-history.md) - the deterministic fix is to make the
// trigger itself remember a pending close, not to trust the model to self-regulate a second time.
// Bounded to the last few messages (not the whole thread) so this doesn't leak into unrelated
// later chat in the same thread if the close attempt is abandoned rather than answered.
const CLOSE_ATTEMPT_LOOKBACK = 4;

export function wasCloseAttemptPending(priorMessages: ChatMessage[]): boolean {
  return priorMessages.slice(-CLOSE_ATTEMPT_LOOKBACK).some((m) => m.role === "user" && isCloseSignal(m.text));
}
