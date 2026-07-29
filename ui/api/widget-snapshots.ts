/**
 * widget-snapshots.ts — compute Warm Instrument Home snapshots server-side (ADR 0005).
 *
 * Fetches gen/aggregate.json from the athlete's GitHub repo, runs the same TS models as
 * the web home dashboard, and returns WidgetSnapshotsFile JSON. Athlete repos never need
 * carved model code or a committed widget_snapshots.json.
 *
 * Auth: session cookie (web) or Bearer token + X-Coach-Repo (iOS).
 */
import { fetchRepoAggregate } from "./auth/_lib/github-aggregate.js";
import type { RepoAggregateInput } from "./auth/_lib/generate-widget-snapshots-from-aggregate.js";
import { generateWidgetSnapshotsFromAggregate } from "./auth/_lib/generate-widget-snapshots-from-aggregate.bundle.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { withSessionCookie } from "./auth/_lib/session.js";

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // Declared outside the try block so the catch clause can still attach a rotated cookie
    // (ensureFreshSession's refresh_token rotation, see ADR 0009) if auth resolved fine but
    // something downstream threw - GitHub rotates refresh tokens on each use, so dropping a
    // successful rotation here would strand the *next* request with an already-invalidated
    // refresh_token.
    let auth: RepoAuthContext | undefined;

    try {
      const resolved = await resolveRepoAuth(req);
      if (resolved instanceof Response) return resolved;
      auth = resolved;

      const fetched = await fetchRepoAggregate(auth.repo_full_name, auth.gh_token);
      if ("error" in fetched) {
        return withSessionCookie(Response.json({ error: fetched.error }, { status: fetched.status }), auth.setCookie);
      }

      const snapshots = generateWidgetSnapshotsFromAggregate(
        fetched.aggregate as RepoAggregateInput,
      );
      if (!snapshots) {
        return withSessionCookie(
          Response.json(
            { error: "No challenge_v2.json in aggregate — complete coach intake first" },
            { status: 404 },
          ),
          auth.setCookie,
        );
      }

      const headers = new Headers({
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=180",
      });
      if (auth.setCookie) headers.append("Set-Cookie", auth.setCookie);

      return new Response(JSON.stringify(snapshots), { status: 200, headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Snapshot generation failed";
      console.error("[widget-snapshots]", err);
      return withSessionCookie(Response.json({ error: message }, { status: 500 }), auth?.setCookie);
    }
  },
};
