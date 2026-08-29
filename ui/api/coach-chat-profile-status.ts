/**
 * coach-chat-profile-status.ts — B2: has this athlete finished the First Session Protocol?
 *
 * GET → {profileComplete}
 *
 * Not tied to a chat turn - a lightweight live check iOS polls on every app launch while its
 * local Keychain flag is still false (B3, replacing the dead shouldOpenChatFirst() thread-
 * existence heuristic), instead of inferring completion from "does any thread exist" - a thread
 * existing has never meant the intake actually finished (that was the premature-completion bug
 * this replaces).
 *
 * Auth: session cookie (web) or Bearer token + X-Coach-Repo (iOS) - same as coach-chat.ts.
 */
import { withSessionCookie } from "./auth/_lib/session.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { loadCoachContext, isAthleteProfileComplete } from "./coach-chat/_lib/coachChatFiles.js";
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

        const { profile, memory, seasons } = await loadCoachContext(
          auth.repo_full_name,
          auth.gh_token,
        );
        const profileComplete = isAthleteProfileComplete(profile, memory, seasons);
        return withSessionCookie(Response.json({ profileComplete }), auth.setCookie);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Coach chat profile status failed";
        const status = (err as { status?: number }).status === 401 ? 401 : 500;
        console.error("[coach-chat-profile-status]", err);
        // End of the line: the athlete gets a status and nothing rethrows, so a GitHub or
        // session failure reaches Sentry only if it is captured here.
        await captureServerException(err);
        return withSessionCookie(Response.json({ error: message }, { status }), auth?.setCookie);
      }
    });
  },
};
