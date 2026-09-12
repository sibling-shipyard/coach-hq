/** Authenticated post-sync Coach generation and latest-message persistence. */
import { commitFilesAtomic } from "./_lib/githubGitData.js";
import { selectLlmAdapter } from "./_lib/llmClient.js";
import { SOUL } from "./_generated/soul.js";
import { resolveRepoAuth, type RepoAuthContext } from "./auth/_lib/resolve-auth.js";
import { withSessionCookie } from "./auth/_lib/session.js";
import { withSentryRoute } from "./_lib/sentry.js";
import { getFileRaw, resolveCoachChatBranch } from "./coach-chat/_lib/decide/coachChatFiles.js";
import {
  generateAndStoreCoachMessage,
  generateProactiveBody,
  listActivityFiles,
  parseActivityIdsRequest,
} from "./coach-message/_lib/coachMessage.js";

export async function handle(req: Request, auth: RepoAuthContext): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const activityIds = await parseActivityIdsRequest(req);
  const repo = auth.repo_full_name;
  const token = auth.gh_token;
  const result = await generateAndStoreCoachMessage(activityIds, {
    readFile: (path) => getFileRaw(repo, path, token),
    listActivityFiles: () => listActivityFiles(repo, token),
    generateBody: (prompt) => generateProactiveBody(selectLlmAdapter(), prompt),
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
    return withSentryRoute(req, async ({ captureException, setAthleteScope }) => {
      const resolved = await resolveRepoAuth(req);
      if (resolved instanceof Response) return resolved;
      setAthleteScope(resolved.repo_full_name);
      try {
        return withSessionCookie(await handle(req, resolved), resolved.setCookie);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Coach message generation failed";
        const rawStatus = (error as { status?: unknown }).status;
        const status =
          typeof rawStatus === "number" && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
        console.error("[coach-message]", error);
        await captureException(error);
        return withSessionCookie(Response.json({ error: message }, { status }), resolved.setCookie);
      }
    });
  },
};
