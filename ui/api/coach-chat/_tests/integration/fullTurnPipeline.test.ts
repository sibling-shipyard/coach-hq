import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The full turn pipeline, layers 1-3 wired together, with `fetch` mocked only at the true
 * network edge: Gemini's generateContent/cachedContents endpoints and GitHub's contents + git
 * data API. Everything else - prompt building (geminiClient.ts), schema-optional field handling,
 * every turnWrites/* builder, and commitFilesAtomic's real blob->tree->commit->ref sequence -
 * runs unmodified. A fake in-memory GitHub repo (below) tracks committed file content so tests
 * can assert on what actually landed, the same way a real athlete repo would show it.
 *
 * This is deliberately a different kind of test than integration/coachTurn.test.ts (which
 * injects a prebuilt TurnWrites and mocks commitFilesAtomic directly) - that file checks each
 * stage's own logic; this file checks the layers are wired together correctly end to end.
 */
const { fetchWithTimeout } = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
}));
vi.mock("../../../_lib/httpTimeout.js", () => ({
  fetchWithTimeout,
  UPSTREAM_TIMEOUT_MS: 25_000,
}));

import {
  loadTurnState,
  requestCoachReply,
  buildTurnWrites,
  commitOrdinaryTurn,
  commitClosingTurn,
  type TurnRequest,
} from "../../_lib/coachTurn.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A fake GitHub repo: real content-addressed blob/tree/commit objects, a real branch ref, and
 * a `files` view of what's actually landed - kept in sync only when a ref-update actually lands,
 * same as real git. */
function createFakeRepo(initialFiles: Record<string, string>) {
  const files = new Map(Object.entries(initialFiles));
  const blobs = new Map<string, string>(); // blobSha -> decoded content
  const trees = new Map<string, { path: string; sha: string }[]>(); // treeSha -> entries
  const commits = new Map<string, string>(); // commitSha -> treeSha
  let headSha = "head-sha-0";
  let blobCounter = 0;
  let treeCounter = 0;
  let commitCounter = 0;
  const committedMessages: string[] = [];

  async function handle(url: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? "GET";

    const contentsMatch = url.match(/\/contents\/(.+?)\?ref=/);
    if (contentsMatch && method === "GET") {
      const path = decodeURIComponent(contentsMatch[1]);
      const content = files.get(path);
      return content == null
        ? jsonResponse(404, { message: "Not Found" })
        : new Response(content, { status: 200 });
    }
    if (url.match(/\/git\/ref\/heads\//) && method === "GET") {
      return jsonResponse(200, { object: { sha: headSha } });
    }
    if (url.match(/\/git\/commits\/([^/]+)$/) && method === "GET") {
      const sha = url.match(/\/git\/commits\/([^/]+)$/)![1];
      const treeSha = commits.get(sha) ?? "tree-empty";
      return jsonResponse(200, { tree: { sha: treeSha } });
    }
    if (url.endsWith("/git/blobs") && method === "POST") {
      const body = JSON.parse(init.body as string) as { content: string; encoding: string };
      const decoded = decodeURIComponent(escape(atob(body.content)));
      blobCounter += 1;
      const sha = `blob-${blobCounter}`;
      blobs.set(sha, decoded);
      return jsonResponse(201, { sha });
    }
    if (url.endsWith("/git/trees") && method === "POST") {
      const body = JSON.parse(init.body as string) as { tree: { path: string; sha: string }[] };
      treeCounter += 1;
      const sha = `tree-${treeCounter}`;
      trees.set(sha, body.tree);
      return jsonResponse(201, { sha });
    }
    if (url.endsWith("/git/commits") && method === "POST") {
      const body = JSON.parse(init.body as string) as { message: string; tree: string };
      commitCounter += 1;
      const sha = `commit-${commitCounter}`;
      commits.set(sha, body.tree);
      committedMessages.push(body.message);
      return jsonResponse(201, { sha });
    }
    if (url.match(/\/git\/refs\/heads\//) && method === "PATCH") {
      const body = JSON.parse(init.body as string) as { sha: string };
      const treeSha = commits.get(body.sha);
      const entries = treeSha ? (trees.get(treeSha) ?? []) : [];
      for (const entry of entries) {
        const content = blobs.get(entry.sha);
        if (content != null) files.set(entry.path, content);
      }
      headSha = body.sha;
      return jsonResponse(200, { object: { sha: headSha } });
    }
    throw new Error(`fake repo: unhandled request ${method} ${url}`);
  }

  return { files, handle, committedMessages, headSha: () => headSha };
}

function createFakeGemini(replies: unknown[]) {
  let index = 0;
  async function handle(url: string): Promise<Response> {
    if (url.includes("cachedContents"))
      return jsonResponse(500, { message: "caching disabled in test" });
    const reply = replies[index++];
    if (reply === undefined) throw new Error(`fake gemini: no canned reply left for call ${index}`);
    return jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }],
      usageMetadata: { promptTokenCount: 50, cachedContentTokenCount: 0 },
    });
  }
  return { handle };
}

const COMPLETE_PROFILE = JSON.stringify({
  name: "Skanda",
  dob: "1995-01-01",
  timezone: "UTC",
  height_cm: 180,
  weight_kg: 75,
  coach_since: "2026-01-01",
});
const MEMORY_WITH_SPORT = JSON.stringify({ sports: ["Running"] });
const SEASON = JSON.stringify({
  current_season_id: "s1",
  seasons: [{ id: "s1", name: "Base", start_date: "2026-01-01", end_date: "2026-12-31" }],
});
const QUESTS_WITH_MAIN = JSON.stringify({
  main_quest: { id: "q1", name: "Consistency", type: "daily_streak", target: 1 },
});

function repoFixture(overrides: Record<string, string> = {}) {
  return {
    "user_data/coach/profile.json": COMPLETE_PROFILE,
    "user_data/coach/memory.json": MEMORY_WITH_SPORT,
    "user_data/ledger/seasons.json": SEASON,
    "user_data/ledger/quests.json": QUESTS_WITH_MAIN,
    ...overrides,
  };
}

// repoName is a distinct string per call, not a shared constant - loadCoachContext
// (coachChatFiles.ts) keeps a module-level cache keyed only by repo name with a 60s TTL, so two
// tests sharing one repo name could silently read each other's cached CoachContext instead of
// their own fixture. Harmless today (no test here asserts on a value that would differ across
// runs), but would produce a silent false pass/fail the moment a future test's assertion does.
async function runTurn(
  repoName: string,
  repo: ReturnType<typeof createFakeRepo>,
  gemini: ReturnType<typeof createFakeGemini>,
  request: TurnRequest,
) {
  fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.includes("generativelanguage.googleapis.com")) return gemini.handle(url);
    return repo.handle(url, init);
  });
  const turnState = await loadTurnState(request, repoName, "test-token", "test-api-key");
  if (turnState instanceof Response)
    throw new Error(`loadTurnState failed: ${await turnState.text()}`);
  const replied = await requestCoachReply(turnState);
  if (replied instanceof Response) return replied;
  const writes = await buildTurnWrites(replied);
  return replied.closing ? commitClosingTurn(writes) : commitOrdinaryTurn(writes);
}

describe("full turn pipeline (layers 1-3 wired together, network mocked only)", () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset();
  });

  it("an ordinary First Session turn with a profile_update lands in profile.json and returns the fresh repoSha", async () => {
    // Deliberately no seasons.json/quests.json/complete profile - isFirstSessionRitualDone
    // (coachChatFiles.ts) is false whenever any of profile/memory/seasons is missing or
    // incomplete, which is exactly the state this test needs.
    const repo = createFakeRepo({
      "user_data/coach/profile.json": JSON.stringify({ name: "Skanda", timezone: "UTC" }),
    });
    const gemini = createFakeGemini([
      {
        reply: "Got it, noted your birthday.",
        profile_update: [{ field: "dob", value: "1995-01-01" }],
      },
    ]);

    const response = await runTurn("owner/repo-1", repo, gemini, {
      threadId: "thread-1",
      priorMessages: [],
      trimmed: "I was born Jan 1 1995",
      geminiMessage: "I was born Jan 1 1995",
      endConversationRequested: false,
    });

    const body = await response.json();
    expect(body).toMatchObject({ reply: "Got it, noted your birthday.", closed: false });
    expect(body.repoSha).not.toBe("head-sha-0");
    const committedProfile = JSON.parse(repo.files.get("user_data/coach/profile.json")!);
    expect(committedProfile.dob).toBe("1995-01-01");
    // Untouched fields survive the merge - this is the layer-1/layer-2 seam actually working
    // together, not a layer-2 test overwriting the whole file.
    expect(committedProfile.name).toBe("Skanda");
    // chatWrite is folded into the always-commit set on ordinary turns too (#616).
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(true);
  });

  it("an ordinary turn with a profile_update lands immediately for a returning (complete-profile) athlete (#616)", async () => {
    const repo = createFakeRepo(repoFixture());
    const gemini = createFakeGemini([
      {
        reply: "Got it, updated your weight.",
        profile_update: [{ field: "weight_kg", value: "76" }],
      },
    ]);

    const response = await runTurn("owner/repo-1b", repo, gemini, {
      threadId: "thread-1b",
      priorMessages: [],
      trimmed: "I'm 76kg now",
      geminiMessage: "I'm 76kg now",
      endConversationRequested: false,
    });

    const body = await response.json();
    expect(body).toMatchObject({ reply: "Got it, updated your weight.", closed: false });
    expect(body.repoSha).not.toBe("head-sha-0");
    const committedProfile = JSON.parse(repo.files.get("user_data/coach/profile.json")!);
    expect(committedProfile.weight_kg).toBe(76);
  });

  it("a closing turn with a coach_note commits chat + coach_log together and reports closed", async () => {
    const repo = createFakeRepo(repoFixture());
    const gemini = createFakeGemini([
      {
        reply: "Nice work today, rest up.",
        coach_note: "Athlete reported feeling strong.",
        session_closed: true,
      },
    ]);

    const response = await runTurn("owner/repo-2", repo, gemini, {
      threadId: "thread-2",
      priorMessages: [],
      trimmed: "That's it for today, thanks coach",
      geminiMessage: "That's it for today, thanks coach",
      endConversationRequested: true,
    });

    const body = await response.json();
    expect(body).toMatchObject({
      reply: "Nice work today, rest up.",
      closed: true,
      threadId: "thread-2",
    });
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(true);
    expect(repo.files.get("user_data/coach/coach_log.json")).toContain(
      "Athlete reported feeling strong.",
    );
    const chatHistory = JSON.parse(repo.files.get("user_data/coach/chat_history.json")!);
    // A new thread's first turn leads with the divider (see appendConversationTurn in
    // chatThreads.ts) - only a thread with prior messages appends without one.
    expect(chatHistory.threads[0].messages.map((m: { role: string }) => m.role)).toEqual([
      "divider",
      "user",
      "coach",
    ]);
  });

  it('issue #609/D1 (#736): a template_edit sentinel of "none" no longer costs the chat message', async () => {
    // D1 layer 3 splits the facts commit from the chat commit - a bad structured field
    // (template_edit referencing a nonexistent template) fails only the facts commit; the chat
    // message still lands, and the failure surfaces as a dropped action instead of a 502 that
    // discarded everything, including the otherwise-valid chat write.
    const repo = createFakeRepo(repoFixture());
    const gemini = createFakeGemini([
      { reply: "All set for today.", template_edit: { template_id: "none" }, session_closed: true },
    ]);

    const response = await runTurn("owner/repo-3", repo, gemini, {
      threadId: "thread-3",
      priorMessages: [],
      trimmed: "Done, see you tomorrow",
      geminiMessage: "Done, see you tomorrow",
      endConversationRequested: true,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ reply: "All set for today.", closed: true });
    expect(body.droppedActions).toEqual([
      expect.objectContaining({
        field: "user_data/activities/workout_plans/templates/none.json",
      }),
    ]);
    // The chat message committed despite the facts commit failing.
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(true);
  });

  it("D1 (#736): a valid profile_update commits while an invalid quest_event (post-retry-exhaustion) is dropped, chat commits either way", async () => {
    const repo = createFakeRepo(repoFixture());
    // quests.json's only valid id is "q1" (QUESTS_WITH_MAIN). Gemini references "q99" both times
    // - the initial reply and layer 2's one corrective retry - so the corrective retry exhausts
    // and layer 3 drops just the quest_event, keeping the valid profile_update.
    const badQuestReply = {
      reply: "Logged your weight and marked the quest.",
      profile_update: [{ field: "weight_kg", value: "77" }],
      quest_event: [{ quest_id: "q99", status: "completed" }],
    };
    const gemini = createFakeGemini([badQuestReply, badQuestReply]);

    const response = await runTurn("owner/repo-4", repo, gemini, {
      threadId: "thread-4",
      priorMessages: [],
      trimmed: "Did my run and I'm 77kg now",
      geminiMessage: "Did my run and I'm 77kg now",
      endConversationRequested: false,
    });

    const body = await response.json();
    expect(body).toMatchObject({
      reply: "Logged your weight and marked the quest.",
      closed: false,
    });
    expect(body.droppedActions).toEqual([expect.objectContaining({ field: "quest_event" })]);
    const committedProfile = JSON.parse(repo.files.get("user_data/coach/profile.json")!);
    expect(committedProfile.weight_kg).toBe(77);
    expect(repo.files.has("user_data/ledger/progress.json")).toBe(false);
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(true);
  });

  it("D1 (#736): a forced chat-commit failure still returns Coach's reply on the ordinary path", async () => {
    const repo = createFakeRepo(repoFixture());
    const gemini = createFakeGemini([{ reply: "Got it, noted.", session_closed: false }]);
    fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.includes("generativelanguage.googleapis.com")) return gemini.handle(url);
      // The only write on this ordinary turn is chatWrite - failing every blob upload forces
      // the chat commit itself to fail (githubGitData.ts retries 3x, then throws).
      if (url.endsWith("/git/blobs")) return jsonResponse(500, { message: "forced failure" });
      return repo.handle(url, init);
    });

    const turnState = await loadTurnState(
      {
        threadId: "thread-5",
        priorMessages: [],
        trimmed: "Just checking in",
        geminiMessage: "Just checking in",
        endConversationRequested: false,
      },
      "owner/repo-5",
      "test-token",
      "test-api-key",
    );
    if (turnState instanceof Response) throw new Error("loadTurnState failed");
    const replied = await requestCoachReply(turnState);
    if (replied instanceof Response) throw new Error("requestCoachReply failed");
    const writes = await buildTurnWrites(replied);
    const response = await commitOrdinaryTurn(writes);

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.reply).toBe("Got it, noted.");
    expect(body.error).toContain("saving failed");
    expect(body.traceId).toBeTruthy();
  });
});
