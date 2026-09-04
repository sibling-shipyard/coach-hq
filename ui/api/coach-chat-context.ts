/**
 * coach-chat-context.ts — warm the files coach-chat.ts injects into every Gemini call
 * (SOUL plus profile/memory/injuries/coach_log, the split quest ledger, and athlete insights), ahead of the athlete
 * ever opening the chat page/tab (A3).
 *
 * GET → the full CoachContext returned by loadCoachContext
 *
 * Not tied to a chat turn - exposes loadCoachContext's read-through cache (60s TTL) so the app
 * shell can trigger it on load, and the eventual greeting/first message skips a redundant round-trip.
 *
 * Auth: session cookie (web) or Bearer token + X-Coach-Repo (iOS) - same as coach-chat.ts.
 */
import { withSessionCookie } from "./auth/_lib/session.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { loadCoachContext } from "./coach-chat/_lib/decide/coachChatFiles.js";
import { withSentryRoute } from "./_lib/sentry.js";

export default {
  async fetch(req: Request): Promise<Response> {
    return withSentryRoute(req, async ({ captureException, setAthleteScope }) => {
      if (req.method !== "GET") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      }

      let auth: RepoAuthContext | undefined;
      try {
        const resolved = await resolveRepoAuth(req);
        if (resolved instanceof Response) return resolved;
        auth = resolved;
        setAthleteScope(auth.repo_full_name);

        const context = await loadCoachContext(auth.repo_full_name, auth.gh_token);
        return withSessionCookie(Response.json(context), auth.setCookie);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Coach chat context failed";
        const status = (err as { status?: number }).status === 401 ? 401 : 500;
        console.error("[coach-chat-context]", err);
        await captureException(err);
        return withSessionCookie(Response.json({ error: message }, { status }), auth?.setCookie);
      }
    });
  },
};
