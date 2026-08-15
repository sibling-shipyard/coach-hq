/**
 * Fire-and-forget warm-up for coach chat's context files (SOUL.md/state.md/quest_log.md), A3.
 *
 * Doesn't hold onto the response - the point isn't to cache content client-side, it's to make
 * sure /api/coach-chat-context.ts's server-side read-through cache (60s TTL, see
 * ui/api/_lib/coach-chat/coachChatFiles.ts) is already warm by the time the athlete actually opens the
 * Coach Chat tab and triggers a greeting turn, so that turn doesn't pay a fresh GitHub
 * round-trip on top of the Gemini call. Call once per app load, not per page - see App.tsx's
 * Gate. A no-op in local dev (no /api routes served there).
 */
let firedThisSession = false;

export function prefetchCoachContext(): void {
  if (import.meta.env.DEV || firedThisSession) return;
  firedThisSession = true;
  fetch("/api/coach-chat-context").catch(() => {
    // Best-effort only - a failed warm-up just means the eventual real turn pays full
    // latency, same as before A3 existed. Not worth surfacing to the athlete.
  });
}
