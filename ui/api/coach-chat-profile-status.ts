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
import { STATE_FILE_PATH, getFileRaw, isAthleteProfileComplete } from "./coach-chat/_lib/coachChatFiles.js";

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    let auth: RepoAuthContext | undefined;
    try {
      const resolved = await resolveRepoAuth(req);
      if (resolved instanceof Response) return resolved;
      auth = resolved;

      const stateMd = await getFileRaw(auth.repo_full_name, STATE_FILE_PATH, auth.gh_token);
      const profileComplete = isAthleteProfileComplete(stateMd ?? "");
      return withSessionCookie(Response.json({ profileComplete }), auth.setCookie);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Coach chat profile status failed";
      const status = (err as { status?: number }).status === 401 ? 401 : 500;
      console.error("[coach-chat-profile-status]", err);
      return withSessionCookie(Response.json({ error: message }, { status }), auth?.setCookie);
    }
  },
};
