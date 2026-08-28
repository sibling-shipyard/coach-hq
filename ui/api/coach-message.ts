/** Authenticated post-sync Coach generation and latest-message persistence. */
import { commitFilesAtomic } from "./_lib/githubGitData.js";
import { fetchWithTimeout } from "./_lib/httpTimeout.js";
import { SOUL } from "./_generated/soul.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { withSessionCookie } from "./auth/_lib/session.js";
import {
  getFileRaw,
  getHeadSha,
  resolveCoachChatBranch,
} from "./coach-chat/_lib/coachChatFiles.js";
import {
  CoachMessageError,
  generateAndStoreCoachMessage,
  generateProactiveBody,
  parseActivityHistoryTree,
  parseActivityIdsRequest,
  type ActivityFileEntry,
} from "./coach-message/_lib/coachMessage.js";

const GITHUB_API = "https://api.github.com";

async function listActivityFiles(repo: string, token: string): Promise<ActivityFileEntry[]> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const readGitJson = async (path: string): Promise<unknown> => {
    const response = await fetchWithTimeout(`${GITHUB_API}/repos/${repo}${path}`, { headers });
    if (!response.ok) {
      throw Object.assign(new Error(`Failed to read GitHub tree (${response.status})`), {
        status: response.status,
      });
    }
    return response.json() as Promise<unknown>;
  };

  const branch = resolveCoachChatBranch();
  const headSha = await getHeadSha(repo, token, branch);
  const commit = await readGitJson(`/git/commits/${encodeURIComponent(headSha)}`);
  if (
    !commit ||
    typeof commit !== "object" ||
    !("tree" in commit) ||
    !commit.tree ||
    typeof commit.tree !== "object" ||
    !("sha" in commit.tree) ||
    typeof commit.tree.sha !== "string"
  ) {
    throw new CoachMessageError("GitHub commit tree is malformed", 502);
  }
  const tree = await readGitJson(`/git/trees/${encodeURIComponent(commit.tree.sha)}?recursive=1`);
  return parseActivityHistoryTree(tree);
}

async function handle(req: Request, auth: RepoAuthContext): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const activityIds = await parseActivityIdsRequest(req);
  const repo = auth.repo_full_name;
  const token = auth.gh_token;
  const result = await generateAndStoreCoachMessage(activityIds, {
    readFile: (path) => getFileRaw(repo, path, token),
    listActivityFiles: () => listActivityFiles(repo, token),
    generateBody: (prompt) => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new CoachMessageError("Coach message generation is not configured", 500);
      }
      return generateProactiveBody(apiKey, prompt);
    },
    commitFiles: (files, message) =>
      commitFilesAtomic(files, message, {
        repo,
        branch: resolveCoachChatBranch(),
        token,
      }),
    soul: SOUL,
  });
  return Response.json({
    message: result.message,
    delivered: true,
    idempotent: result.idempotent,
    should_notify: result.shouldNotify,
    repoSha: result.commitSha,
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    const resolved = await resolveRepoAuth(req);
    if (resolved instanceof Response) return resolved;
    try {
      return withSessionCookie(await handle(req, resolved), resolved.setCookie);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Coach message generation failed";
      const rawStatus = (error as { status?: unknown }).status;
      const status =
        typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
      console.error("[coach-message]", error);
      return withSessionCookie(Response.json({ error: message }, { status }), resolved.setCookie);
    }
  },
};
