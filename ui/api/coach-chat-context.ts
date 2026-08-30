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
import { loadCoachContext } from "./coach-chat/_lib/coachChatFiles.js";
import { captureServerException, setAthleteScope, withContinuedTrace } from "./_lib/sentry.js";

export default {
  async fetch(req: Request): Promise<Response> {
    // Entry, before anything can capture: joins the browser's trace so both events share one,
    // opens the route's `http.server` span, and flushes it before the response leaves.
    return withContinuedTrace(req, async () => {
      if (req.method !== "GET") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      }

      let auth: RepoAuthContext | undefined;
      try {
        const resolved = await resolveRepoAuth(req);
        if (resolved instanceof Response) return resolved;
        auth = resolved;
        // Who, as soon as it is known. Everything below can capture; nothing above can say whose
        // request this is, so an auth failure stays as anonymous as it is today.
        setAthleteScope(auth.repo_full_name);

        const context = await loadCoachContext(auth.repo_full_name, auth.gh_token);
        return withSessionCookie(Response.json(context), auth.setCookie);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Coach chat context failed";
        const status = (err as { status?: number }).status === 401 ? 401 : 500;
        console.error("[coach-chat-context]", err);
        // End of the line: the athlete gets a status and nothing rethrows, so a GitHub or
        // session failure reaches Sentry only if it is captured here.
        await captureServerException(err);
        return withSessionCookie(Response.json({ error: message }, { status }), auth?.setCookie);
      }
    });
  },
};
