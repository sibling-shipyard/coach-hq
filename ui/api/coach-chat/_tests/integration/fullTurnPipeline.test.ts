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
  commitTurn,
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
  main_quest: { id: "q1", name: "Consistency", type: "daily_streak", target: 1, season_id: "s1" },
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
  return commitTurn(writes);
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
        coach_note: "Athlete's date of birth confirmed: 1995-01-01.",
      },
    ]);

    const response = await runTurn("owner/repo-1", repo, gemini, {
      threadId: "thread-1",
      priorMessages: [],
      trimmed: "I was born Jan 1 1995",
      geminiMessage: "I was born Jan 1 1995",
    });

    const body = await response.json();
    expect(body).toMatchObject({ reply: "Got it, noted your birthday." });
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
        coach_note: "Athlete reported new weight: 76kg.",
      },
    ]);

    const response = await runTurn("owner/repo-1b", repo, gemini, {
      threadId: "thread-1b",
      priorMessages: [],
      trimmed: "I'm 76kg now",
      geminiMessage: "I'm 76kg now",
    });

    const body = await response.json();
    expect(body).toMatchObject({ reply: "Got it, updated your weight." });
    expect(body.repoSha).not.toBe("head-sha-0");
    const committedProfile = JSON.parse(repo.files.get("user_data/coach/profile.json")!);
    expect(committedProfile.weight_kg).toBe(76);
  });

  // A real, schema-valid template - mirrors templateEdit.test.ts's fixture, needed here because
  // applyTemplateEdit's final step (validateWorkout) rejects anything less than a full Workout.
  const VALID_TEMPLATE = JSON.stringify({
    id: "strength_b",
    title: "Strength B",
    subtitle: "Upper body focus",
    workout_type: "strength",
    estimated_duration_mins: 45,
    location: "gym",
    equipment: ["dumbbells"],
    coaching_note: "Keep form tight.",
    phases: [
      {
        name: "Warmup",
        duration: "10 min",
        default_rest_secs: 30,
        exercises: [
          {
            num: 1,
            name: "Arm circles",
            type: "timed",
            duration_secs: 30,
            sets: 1,
            form_cue: "Slow.",
            why: "Warm up.",
          },
        ],
      },
      {
        name: "Main set",
        duration: "30 min",
        default_rest_secs: 60,
        exercises: [
          {
            num: 2,
            name: "Push-ups",
            type: "reps",
            reps: 12,
            sets: 3,
            form_cue: "Elbows in.",
            why: "Chest strength.",
          },
        ],
      },
    ],
  });

  // C1: template_edit commits on an ordinary turn now - there is no closing turn left to gate
  // it behind. This also exercises the lazy templates-manifest fetch (correction #4): the
  // manifest is only read from the fake repo because this reply asked for template_edit.
  it("a template_edit commits chat + the template together on an ordinary turn, no close signal", async () => {
    const repo = createFakeRepo(
      repoFixture({
        "user_data/activities/workout_plans/templates/_manifest.json": JSON.stringify({
          template_ids: ["strength_b"],
        }),
        "user_data/activities/workout_plans/templates/strength_b.json": VALID_TEMPLATE,
      }),
    );
    const gemini = createFakeGemini([
      {
        reply: "Dropped the warmup from Strength B going forward.",
        template_edit: { template_id: "strength_b", skip_phases: ["Warmup"] },
      },
    ]);

    const response = await runTurn("owner/repo-2", repo, gemini, {
      threadId: "thread-2",
      priorMessages: [],
      trimmed: "Drop the warmup from my strength template for good",
      geminiMessage: "Drop the warmup from my strength template for good",
    });

    const body = await response.json();
    expect(body).toMatchObject({
      reply: "Dropped the warmup from Strength B going forward.",
      threadId: "thread-2",
    });
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(true);
    const chatHistory = JSON.parse(repo.files.get("user_data/coach/chat_history.json")!);
    // A new thread's first turn leads with the divider (see appendConversationTurn in
    // chatThreads.ts) - only a thread with prior messages appends without one.
    expect(chatHistory.threads[0].messages.map((m: { role: string }) => m.role)).toEqual([
      "divider",
      "user",
      "coach",
    ]);
    const updatedTemplate = JSON.parse(
      repo.files.get("user_data/activities/workout_plans/templates/strength_b.json")!,
    );
    expect(updatedTemplate.phases).toHaveLength(1);
    expect(updatedTemplate.phases[0].name).toBe("Main set");
  });

  it('issue #609/D1 (#736): a template_edit sentinel of "none" no longer costs the chat message', async () => {
    // D1 layer 3 splits the facts commit from the chat commit - a bad structured field
    // (template_edit referencing a nonexistent template) fails only the facts commit; the chat
    // message still lands, and the failure surfaces as a dropped action instead of a 502 that
    // discarded everything, including the otherwise-valid chat write.
    const repo = createFakeRepo(repoFixture());
    const gemini = createFakeGemini([
      { reply: "All set for today.", template_edit: { template_id: "none" } },
    ]);

    const response = await runTurn("owner/repo-3", repo, gemini, {
      threadId: "thread-3",
      priorMessages: [],
      trimmed: "Change my template",
      geminiMessage: "Change my template",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ reply: "All set for today." });
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
    // and layer 3 drops just the quest_event, keeping the valid profile_update. coach_note is
    // included on both replies so C2's missingRequiredCoachNote reprompt never fires here - this
    // test is only about the bad-reference reprompt, not the two enforcement rules interacting.
    const badQuestReply = {
      reply: "Logged your weight and marked the quest.",
      coach_note: "Weight updated, quest completion reported.",
      profile_update: [{ field: "weight_kg", value: "77" }],
      quest_event: [{ quest_id: "q99", status: "completed" }],
    };
    const gemini = createFakeGemini([badQuestReply, badQuestReply]);

    const response = await runTurn("owner/repo-4", repo, gemini, {
      threadId: "thread-4",
      priorMessages: [],
      trimmed: "Did my run and I'm 77kg now",
      geminiMessage: "Did my run and I'm 77kg now",
    });

    const body = await response.json();
    expect(body).toMatchObject({
      reply: "Logged your weight and marked the quest.",
    });
    expect(body.droppedActions).toEqual([expect.objectContaining({ field: "quest_event" })]);
    const committedProfile = JSON.parse(repo.files.get("user_data/coach/profile.json")!);
    expect(committedProfile.weight_kg).toBe(77);
    expect(repo.files.has("user_data/ledger/progress.json")).toBe(false);
    expect(repo.files.has("user_data/coach/chat_history.json")).toBe(true);
  });

  it("D1 (#736): a forced chat-commit failure still returns Coach's reply", async () => {
    const repo = createFakeRepo(repoFixture());
    const gemini = createFakeGemini([{ reply: "Got it, noted." }]);
    fetchWithTimeout.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.includes("generativelanguage.googleapis.com")) return gemini.handle(url);
      // The only write on this turn is chatWrite - failing every blob upload forces the chat
      // commit itself to fail (githubGitData.ts retries 3x, then throws).
      if (url.endsWith("/git/blobs")) return jsonResponse(500, { message: "forced failure" });
      return repo.handle(url, init);
    });

    const turnState = await loadTurnState(
      {
        threadId: "thread-5",
        priorMessages: [],
        trimmed: "Just checking in",
        geminiMessage: "Just checking in",
      },
      "owner/repo-5",
      "test-token",
      "test-api-key",
    );
    if (turnState instanceof Response) throw new Error("loadTurnState failed");
    const replied = await requestCoachReply(turnState);
    if (replied instanceof Response) throw new Error("requestCoachReply failed");
    const writes = await buildTurnWrites(replied);
    const response = await commitTurn(writes);

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.reply).toBe("Got it, noted.");
    expect(body.error).toContain("saving failed");
    expect(body.traceId).toBeTruthy();
  });

  it("D1 (#736): a dropped action folds into the *next* turn's athleteContext, not just the response", async () => {
    // Layer 3 drops the quest_event; the coach_note written this turn (required by C2 whenever
    // another structured field fires) already gets a system note about it appended, proving the
    // dropped-action note rides the same single coach_log.json write every turn already makes -
    // not a separate suppressed-on-ordinary-turns mechanism.
    const repo = createFakeRepo(repoFixture());
    const badQuestReply = {
      reply: "Marked the quest done.",
      coach_note: "Reported a quest completion.",
      quest_event: [{ quest_id: "q99", status: "completed" }],
    };
    const gemini = createFakeGemini([badQuestReply, badQuestReply]);

    const firstTurn = await runTurn("owner/repo-d1-context", repo, gemini, {
      threadId: "thread-6",
      priorMessages: [],
      trimmed: "Finished the run quest",
      geminiMessage: "Finished the run quest",
    });
    const firstBody = await firstTurn.json();
    expect(firstBody.droppedActions).toEqual([expect.objectContaining({ field: "quest_event" })]);

    // Not just committed - readable back as coach_log.json's own content.
    expect(repo.files.get("user_data/coach/coach_log.json")).toContain("quest_event");

    // The real proof: the *next* turn's loadTurnState (which is what feeds askGemini's prompt -
    // coachTurn.ts's requestCoachReply passes turn.athleteContext straight through) actually
    // contains the dropped-action detail, not just something committed nobody reads.
    const secondTurnState = await loadTurnState(
      {
        threadId: "thread-6",
        priorMessages: [],
        trimmed: "Did I get credit for that?",
        geminiMessage: "Did I get credit for that?",
      },
      "owner/repo-d1-context",
      "test-token",
      "test-api-key",
    );
    if (secondTurnState instanceof Response) throw new Error("loadTurnState failed");
    expect(secondTurnState.athleteContext).toContain("quest_event");
  });

  // B3: a returning athlete starting a new season with its goal, plus a habit quest, in the same
  // turn - exercises the real two-file season_start write (seasonWrite/questWrite ordering in
  // turnWrites/seasonWrite.ts) merged with quest_create's own quests.json write, through the
  // actual commit pipeline rather than the pure appliers alone.
  it("a returning athlete's season_start with main_quest retires the old season+goal and bundles a habit quest, one commit", async () => {
    const repo = createFakeRepo(
      repoFixture({
        "user_data/ledger/seasons.json": JSON.stringify({
          current_season_id: "s_old",
          seasons: [
            {
              id: "s_old",
              name: "Base",
              start_date: "2026-01-01",
              end_date: "2026-12-01",
              status: "active",
            },
          ],
        }),
        "user_data/ledger/quests.json": JSON.stringify({
          main_quest: {
            id: "q_old",
            name: "Old Goal",
            type: "count_target",
            target: 10,
            season_id: "s_old",
          },
          quests: [],
        }),
      }),
    );
    const gemini = createFakeGemini([
      {
        reply: "New season locked in.",
        season_start: {
          name: "Marathon Build",
          start_date: "2026-08-18",
          end_date: "2027-02-01",
          main_quest: { name: "Run a marathon", type: "count_target", target: 1 },
          new_habits: [],
        },
        quest_create: { quests: [{ name: "Stretch daily", type: "daily_streak" }] },
        coach_note: "Started a new season: Marathon Build. Added a daily stretch habit quest.",
      },
    ]);

    const response = await runTurn("owner/repo-4", repo, gemini, {
      threadId: "thread-4",
      priorMessages: [],
      trimmed: "New season - I want to run a marathon, and I'll stretch daily too",
      geminiMessage: "New season - I want to run a marathon, and I'll stretch daily too",
    });

    const body = await response.json();
    expect(body).toMatchObject({ reply: "New season locked in." });

    const seasons = JSON.parse(repo.files.get("user_data/ledger/seasons.json")!);
    expect(seasons.seasons.find((s: { id: string }) => s.id === "s_old")).toMatchObject({
      status: "retired",
    });
    const newSeasonId = seasons.current_season_id;
    expect(newSeasonId).not.toBe("s_old");

    const quests = JSON.parse(repo.files.get("user_data/ledger/quests.json")!);
    expect(quests.main_quest).toMatchObject({ name: "Run a marathon", season_id: newSeasonId });
    // Old goal retired into quests[], and the habit quest from quest_create landed alongside it -
    // the season_start/quest_create merge onto one quests.json write actually worked.
    expect(quests.quests).toHaveLength(2);
    expect(quests.quests.find((q: { id: string }) => q.id === "q_old")).toMatchObject({
      status: "retired",
    });
    expect(quests.quests.find((q: { name: string }) => q.name === "Stretch daily")).toMatchObject({
      type: "daily_streak",
      source: "model",
    });
  });
});
