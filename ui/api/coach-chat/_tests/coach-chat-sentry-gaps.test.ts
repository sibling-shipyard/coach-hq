/**
 * B5/B6 (#1078): Response-built 500s on the coach-chat route must call captureServerException —
 * withSentryRoute only captures throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureServerException, loadCoachContext, loadChatHistory, resolveProviderName } =
  vi.hoisted(() => ({
    captureServerException: vi.fn(async (_error: unknown) => ({ sent: true })),
    loadCoachContext: vi.fn(),
    loadChatHistory: vi.fn(async () => ({ threads: [] })),
    resolveProviderName: vi.fn(() => "gemini" as const),
  }));

vi.mock("../../_lib/sentry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/sentry.js")>();
  return {
    ...original,
    captureServerException,
    captureGeminiFailure: vi.fn(async () => ({ sent: true })),
    withProcessingSpan: async <T>(_name: string, fn: () => Promise<T>) => fn(),
    withSentryRoute: async (
      _req: Request,
      handler: (ctx: {
        captureException: typeof captureServerException;
        setAthleteScope: (repo: string) => void;
      }) => Promise<Response>,
    ) => handler({ captureException: captureServerException, setAthleteScope: () => {} }),
  };
});

vi.mock("../_lib/decide/coachChatFiles.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_lib/decide/coachChatFiles.js")>();
  return {
    ...original,
    loadCoachContext,
    getHeadSha: vi.fn(async () => "sha"),
    getHeadShaOrNull: vi.fn(async () => "sha"),
  };
});

vi.mock("../_lib/chatThreads.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_lib/chatThreads.js")>();
  return { ...original, loadChatHistory };
});

vi.mock("../../_lib/llmClient.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../_lib/llmClient.js")>();
  return { ...original, resolveProviderName };
});

import { handle } from "../../coach-chat.js";

const auth = {
  repo_full_name: "owner/repo",
  gh_token: "token",
  login: "owner",
  github_user_id: 1,
};

describe("coach-chat silent 500 capture (B5/B6)", () => {
  beforeEach(() => {
    captureServerException.mockClear();
    loadCoachContext.mockReset();
    loadChatHistory.mockReset();
    loadChatHistory.mockResolvedValue({ threads: [] });
    resolveProviderName.mockReturnValue("gemini");
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_PROVIDER;
  });

  it("B6: captures when the provider API key is missing", async () => {
    const req = new Request("https://example.com/api/coach-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    const res = await handle(req, auth);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "Coach chat isn't configured yet" });
    expect(captureServerException).toHaveBeenCalledTimes(1);
    const missingKeyErr = captureServerException.mock.calls[0]?.[0];
    expect(missingKeyErr).toBeInstanceOf(Error);
    expect((missingKeyErr as Error).message).toContain("isn't configured");
  });

  it("B5: captures when greet finds no SOUL bundle", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    loadCoachContext.mockResolvedValue({
      soul: null,
      profile: null,
      memory: null,
      injuries: null,
      coachLog: null,
      seasons: null,
      quests: null,
      progress: null,
      progressions: null,
      athleteInsights: null,
    });
    const req = new Request("https://example.com/api/coach-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "greet" }),
    });
    const res = await handle(req, auth);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "Coach SOUL bundle is unavailable" });
    expect(captureServerException).toHaveBeenCalledTimes(1);
    const soulErr = captureServerException.mock.calls[0]?.[0];
    expect(soulErr).toBeInstanceOf(Error);
    expect((soulErr as Error).message).toContain("SOUL bundle");
  });
});
