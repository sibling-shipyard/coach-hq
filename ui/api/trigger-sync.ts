import { ensureFreshSession, withSessionCookie } from "./auth/_lib/session.js";

// Every account's sync.yml is named identically - each repo's own workflow decides what
// "sync" actually means for that account (Strava pull, or - since the iOS app already
// pushes directly and PR #151 - a graceful no-op that just regenerates derived data).
// This endpoint's only job is dispatching the *right account's* workflow, not knowing or
// caring what that workflow does internally.
const WORKFLOW_FILE = "sync.yml";
const COOLDOWN_MS = 60_000;

// In-memory per-instance cooldown, keyed by repo - prevents one account's rapid clicking
// from blocking another's, unlike the old single global cooldown timestamp.
const lastDispatchByRepo = new Map<string, number>();

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const fresh = await ensureFreshSession(req);
    if (fresh instanceof Response) return fresh;
    const { session, setCookie } = fresh;

    const repo = session.repo_full_name;
    if (!repo) {
      return withSessionCookie(
        Response.json({ error: "No repo resolved for this account yet" }, { status: 400 }),
        setCookie,
      );
    }

    // The signed-in user's own token, not a shared bot account's PAT - it's already scoped
    // to exactly what *this* user installed the GitHub App on, same pattern every other
    // endpoint here uses (list-my-repos.ts, repo-file.ts). A shared PAT would only ever
    // work for repos its owner happened to be a manual collaborator on - fine for two known
    // accounts, doesn't scale to any future user without an admin action per person. Needs
    // the App's Actions: Read and write permission (added alongside Contents earlier).
    const token = session.gh_token;

    const now = Date.now();
    const lastDispatchTime = lastDispatchByRepo.get(repo) ?? 0;
    if (now - lastDispatchTime < COOLDOWN_MS) {
      const waitSec = Math.ceil((COOLDOWN_MS - (now - lastDispatchTime)) / 1000);
      return withSessionCookie(
        Response.json({ ok: false, error: `Sync already triggered. Try again in ${waitSec}s.` }, { status: 429 }),
        setCookie,
      );
    }

    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ ref: "main" }),
        }
      );

      if (res.status === 204) {
        lastDispatchByRepo.set(repo, now);
        return withSessionCookie(Response.json({ ok: true, message: "Sync triggered" }), setCookie);
      }

      const body = await res.text();
      return withSessionCookie(
        Response.json({ ok: false, error: `GitHub API returned ${res.status}`, detail: body }, { status: res.status }),
        setCookie,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return withSessionCookie(Response.json({ ok: false, error: message }, { status: 500 }), setCookie);
    }
  },
};
