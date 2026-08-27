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
      return content == null ? jsonResponse(404, { message: "Not Found" }) : new Response(content, { status: 200 });
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
    if (url.includes("cachedContents")) return jsonResponse(500, { message: "caching disabled in test" });
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
const SEASON = JSON.stringify({ current_season_id: "s1", seasons: [{ id: "s1", name: "Base", start_date: "2026-01-01", end_date: "2026-12-31" }] });
const QUESTS_WITH_MAIN = JSON.stringify({ main_quest: { id: "q1", name: "Consistency", type: "daily_streak", target: 1 } });

function repoFixture(overrides: Record<string, string> = {}) {
  return {
    "user_data/coach/profile.json": COMPLETE_PROFILE,
    "user_data/coach/memory.json": MEMORY_WITH_SPORT,
    "user_data/ledger/seasons.json": SEASON,
    "user_data/ledger/quests.json": QUESTS_WITH_MAIN,
    ...overrides,
  };
}

async function runTurn(
  repo: ReturnType<typeof createFakeRepo>,
  gemini: ReturnType<typeof createFakeGemini>,
  request: TurnRequest,
) {
  fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.includes("generativelanguage.googleapis.com")) return gemini.handle(url);
    return repo.handle(url, init);
  });
  const turnState = await loadTurnState(request, "owner/repo", "test-token", "test-api-key");
  if (turnState instanceof Response) throw new Error(`loadTurnState failed: ${await turnState.text()}`);
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
    // commitOrdinaryTurn only ever persists fspIncrementalWrites - real behavior (fspWrites.ts)
    // is that an ordinary turn commits nothing at all once the profile was already complete
    // going in; only a still-incomplete profile lets an ordinary turn's profile_update land
    // immediately, as First Session Protocol incremental progress. A complete-profile athlete's
    // profile_update only lands on close (see the next test). Discovered by this test initially
    // asserting the wrong thing against a complete-profile fixture.
    // Deliberately no seasons.json/quests.json/complete profile - isFirstSessionRitualDone
    // (coachChatFiles.ts) is false whenever any of profile/memory/seasons is missing or
    // incomplete, which is exactly the state this test needs.
    const repo = createFakeRepo({
      "user_data/coach/profile.json": JSON.stringify({ name: "Skanda", timezone: "UTC" }),
    });
    const gemini = createFakeGemini([
      { reply: "Got it, noted your birthday.", profile_update: [{ field: "dob", value: "1995-01-01" }] },
    ]);

    const response = await runTurn(repo, gemini, {
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
    // No chat/coach_log write on an ordinary turn, even a First Session one - only the FSP
    // candidate writes commit here.
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(false);
  });

  it("a closing turn with a coach_note commits chat + coach_log together and reports closed", async () => {
    const repo = createFakeRepo(repoFixture());
    const gemini = createFakeGemini([
      { reply: "Nice work today, rest up.", coach_note: "Athlete reported feeling strong.", session_closed: true },
    ]);

    const response = await runTurn(repo, gemini, {
      threadId: "thread-2",
      priorMessages: [],
      trimmed: "That's it for today, thanks coach",
      geminiMessage: "That's it for today, thanks coach",
      endConversationRequested: true,
    });

    const body = await response.json();
    expect(body).toMatchObject({ reply: "Nice work today, rest up.", closed: true, threadId: "thread-2" });
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(true);
    expect(repo.files.get("user_data/coach/coach_log.json")).toContain("Athlete reported feeling strong.");
    const chatHistory = JSON.parse(repo.files.get("user_data/coach/chat_history.json")!);
    // A new thread's first turn leads with the divider (see appendConversationTurn in
    // chatThreads.ts) - only a thread with prior messages appends without one.
    expect(chatHistory.threads[0].messages.map((m: { role: string }) => m.role)).toEqual(["divider", "user", "coach"]);
  });

  it("issue #609: a template_edit sentinel of \"none\" still crashes the closing-turn commit (not fixed by this plan - see coach-chat-testing-layers.md scope guard)", async () => {
    const repo = createFakeRepo(repoFixture());
    const gemini = createFakeGemini([
      { reply: "All set for today.", template_edit: { template_id: "none" }, session_closed: true },
    ]);

    const response = await runTurn(repo, gemini, {
      threadId: "thread-3",
      priorMessages: [],
      trimmed: "Done, see you tomorrow",
      geminiMessage: "Done, see you tomorrow",
      endConversationRequested: true,
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toContain('template_edit: no template with id "none"');
    // Nothing landed - the whole commit failed atomically, including the otherwise-valid chat
    // and coach_log writes bundled in the same turn.
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(false);
  });
});
