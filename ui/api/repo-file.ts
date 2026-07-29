/**
 * repo-file.ts — fetches the signed-in user's resolved repo's gen/aggregate.json
 * via the GitHub Contents API. One call, one file, per the Repo-as-CDN model
 * (WEBSITE_UNIFICATION_PLAN.md Section 7) - not several raw files merged at
 * request time.
 *
 * Uses the `.raw` media type, not the default JSON+base64 wrapper - GitHub's
 * Contents API only inlines base64 `content` for files under ~1MB, and a real
 * activity history aggregate blows past that easily (confirmed: a real
 * aggregate.json came back as `encoding: "none"`, empty `content`, at ~2.8MB).
 * `.raw` returns the actual file bytes directly regardless of size.
 */
import { decryptSession, parseCookies, SESSION_COOKIE } from "./auth/_lib/session.js";

const GH_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github.raw+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

export default {
  async fetch(req: Request): Promise<Response> {
    const cookies = parseCookies(req);
    const raw = cookies[SESSION_COOKIE];
    if (!raw) return Response.json({ error: "Not authenticated" }, { status: 401 });

    const session = await decryptSession(raw);
    if (!session) return Response.json({ error: "Not authenticated" }, { status: 401 });

    if (!session.repo_full_name) {
      return Response.json({ error: "No repo resolved yet - visit /api/auth/list-my-repos first" }, { status: 400 });
    }

    const contentsRes = await fetch(
      `https://api.github.com/repos/${session.repo_full_name}/contents/gen/aggregate.json`,
      { headers: GH_HEADERS(session.gh_token) }
    );

    if (contentsRes.status === 401 || contentsRes.status === 403) {
      // Distinct from a generic failure: this is what a revoked/expired GitHub App
      // installation looks like (user removed access on GitHub's side, or the App was
      // uninstalled) while the session cookie is still within its ~8h window. "Failed to
      // fetch your data" would be misleading here - the fix isn't retrying, it's signing
      // in again. RepoDataGate.tsx keys off this specific error string.
      return Response.json(
        { error: "Your GitHub access was revoked or expired - sign in again to reconnect." },
        { status: 401 }
      );
    }
    if (contentsRes.status === 404) {
      return Response.json(
        { error: "gen/aggregate.json not found in your repo - has it synced yet?" },
        { status: 404 }
      );
    }
    if (!contentsRes.ok) {
      return Response.json({ error: "Failed to fetch your data" }, { status: 502 });
    }

    let aggregate: unknown;
    try {
      aggregate = await contentsRes.json();
    } catch {
      return Response.json({ error: "gen/aggregate.json is not valid JSON" }, { status: 502 });
    }

    return new Response(JSON.stringify(aggregate), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Data changes at most once/day, on sync - short cache is plenty.
        "Cache-Control": "private, max-age=180",
      },
    });
  },
};
