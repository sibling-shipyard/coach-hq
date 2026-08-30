/**
 * repo-file.ts — fetches the signed-in user's resolved repo's gen/dashboard_snapshot.json via the
 * GitHub Contents API (Repo-as-CDN model).
 * Uses `.raw` media type, not the default JSON+base64 wrapper - Contents API only inlines
 * base64 for files under ~1MB, and a real dashboard snapshot can exceed that.
 */
import { ensureFreshSession, withSessionCookie } from "./auth/_lib/session.js";
import { withSentryRoute } from "./_lib/sentry.js";

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

export default {
  async fetch(req: Request): Promise<Response> {
    return withSentryRoute(req, async ({ captureException, setAthleteScope }) => {
      const fresh = await ensureFreshSession(req);
      if (fresh instanceof Response) return fresh;
      const { session, setCookie } = fresh;

      if (!session.repo_full_name) {
        return withSessionCookie(
          Response.json(
            { error: "No repo resolved yet - visit /api/auth/list-my-repos first" },
            { status: 400 },
          ),
          setCookie,
        );
      }
      setAthleteScope(session.repo_full_name);

      let contentsRes: Response;
      try {
        contentsRes = await fetch(
          `https://api.github.com/repos/${session.repo_full_name}/contents/gen/dashboard_snapshot.json`,
          { headers: GH_HEADERS(session.gh_token) },
        );
      } catch (err) {
        // A thrown network error would otherwise propagate uncaught and drop setCookie,
        // stranding the next request with an already-rotated-away refresh_token (ADR 0009).
        // Swallowing it is what makes this the end of the line: the athlete sees an empty
        // dashboard and the throw is recorded nowhere else.
        console.error("[repo-file]", err);
        await captureException(err);
        return withSessionCookie(
          Response.json({ error: "Failed to fetch your data" }, { status: 502 }),
          setCookie,
        );
      }

      if (contentsRes.status === 401 || contentsRes.status === 403) {
        // A revoked/expired GitHub App installation, distinct from ensureFreshSession's routine
        // rotation above - the fix is signing in again, not retrying. RepoDataGate.tsx keys off
        // this exact error string.
        return withSessionCookie(
          Response.json(
            { error: "Your GitHub access was revoked or expired - sign in again to reconnect." },
            { status: 401 },
          ),
          setCookie,
        );
      }
      if (contentsRes.status === 404) {
        return withSessionCookie(
          Response.json(
            { error: "gen/dashboard_snapshot.json not found in your repo - has it synced yet?" },
            { status: 404 },
          ),
          setCookie,
        );
      }
      if (!contentsRes.ok) {
        // 401/403 and 404 answered above, so what reaches here is a GitHub 5xx or a 429 - an
        // outage, not an answer. Nothing threw, so the status is all there is to report.
        const err = new Error(`GitHub returned ${contentsRes.status} for dashboard_snapshot.json`);
        console.error("[repo-file]", err);
        await captureException(err);
        return withSessionCookie(
          Response.json({ error: "Failed to fetch your data" }, { status: 502 }),
          setCookie,
        );
      }

      let aggregate: unknown;
      try {
        aggregate = await contentsRes.json();
      } catch (err) {
        // Same reasoning as the fetch catch above: a snapshot the athlete's repo cannot parse
        // breaks their whole dashboard, and this 502 is the only trace of it.
        console.error("[repo-file] snapshot is not valid JSON", err);
        await captureException(err);
        return withSessionCookie(
          Response.json(
            { error: "gen/dashboard_snapshot.json is not valid JSON" },
            { status: 502 },
          ),
          setCookie,
        );
      }

      const headers = new Headers({
        "Content-Type": "application/json",
        // Was "private, max-age=180" - but "private" only stops shared/CDN caches, not the
        // browser's own HTTP cache, and there's no Vary header to scope it by session. A same-URL
        // fetch() within that window could be served the PREVIOUS signed-in account's cached
        // response, even after a full page reload with a fresh session cookie - real cross-account
        // data leak, confirmed live. no-store closes it; the perf cost (no free reload-window
        // cache) is a minor tradeoff against that.
        "Cache-Control": "private, no-store",
      });
      if (setCookie) headers.append("Set-Cookie", setCookie);

      return new Response(JSON.stringify(aggregate), { status: 200, headers });
    });
  },
};
