/**
 * waitlist.ts — capture marketing waitlist emails on Vercel.
 *
 * POST { email, source? } appends to platform/waitlist.json in the HQ repo via GitHub.
 * Env: WAITLIST_GITHUB_TOKEN (or GITHUB_PAT), optional WAITLIST_GITHUB_REPO
 * (default sibling-shipyard/coach-phelps-hq).
 */
import { commitFilesAtomic } from "./_lib/githubGitData.js";

const WAITLIST_PATH = "platform/waitlist.json";
const DEFAULT_REPO = "sibling-shipyard/coach-phelps-hq";
const BRANCH = "main";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WaitlistEntry {
  email: string;
  created_at: string;
  source: string;
}

interface WaitlistFile {
  entries: WaitlistEntry[];
}

function waitlistConfig(): { repo: string; token: string } | null {
  const token = process.env.WAITLIST_GITHUB_TOKEN ?? process.env.GITHUB_PAT ?? "";
  const repo = process.env.WAITLIST_GITHUB_REPO ?? DEFAULT_REPO;
  if (!token) return null;
  return { repo, token };
}

async function readWaitlistFile(repo: string, token: string): Promise<WaitlistFile> {
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${WAITLIST_PATH}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 404) return { entries: [] };
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to read waitlist (${res.status}): ${detail}`);
  }
  const parsed = (await res.json()) as WaitlistFile;
  if (!Array.isArray(parsed.entries)) return { entries: [] };
  return parsed;
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const config = waitlistConfig();
    if (!config) {
      return Response.json({ error: "Waitlist is not configured" }, { status: 503 });
    }

    let body: { email?: string; source?: string; website?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (body.website) {
      return Response.json({ ok: true }, { status: 201 });
    }

    const email = body.email?.trim().toLowerCase() ?? "";
    if (!EMAIL_RE.test(email)) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }

    const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "welcome";

    let duplicate = false;

    try {
      await commitFilesAtomic(
        [
          {
            path: WAITLIST_PATH,
            resolve: async () => {
              const current = await readWaitlistFile(config.repo, config.token);
              const exists = current.entries.some((entry) => entry.email === email);
              if (exists) {
                duplicate = true;
                return JSON.stringify(current, null, 2) + "\n";
              }
              const next: WaitlistFile = {
                entries: [
                  ...current.entries,
                  { email, created_at: new Date().toISOString(), source },
                ],
              };
              return JSON.stringify(next, null, 2) + "\n";
            },
          },
        ],
        duplicate ? `waitlist: duplicate ${email}` : `waitlist: ${email}`,
        { repo: config.repo, branch: BRANCH, token: config.token },
      );
    } catch (err) {
      console.error("waitlist commit failed:", err);
      return Response.json({ error: "Could not save your email — try again later" }, { status: 502 });
    }

    return Response.json({ ok: true, duplicate }, { status: duplicate ? 200 : 201 });
  },
};
