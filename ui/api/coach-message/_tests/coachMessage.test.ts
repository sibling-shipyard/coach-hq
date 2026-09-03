import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../_lib/githubGitData.js";
import {
  CoachMessageError,
  MAX_ACTIVITY_IDS,
  PROACTIVE_FEW_SHOT_PAIRS,
  buildProactivePrompt,
  generateAndStoreCoachMessage,
  generateProactiveBody,
  loadProactiveContext,
  parseActivityHistoryTree,
  parseActivityIdsRequest,
  validateActivityIdsPayload,
  validateGeneratedBody,
  type CoachMessageDependencies,
  type LatestCoachMessage,
} from "../_lib/coachMessage.js";

const UUID = "8F3AE2C1-4D90-4A87-9A75-5A36A0FB954C";
const OTHER_UUID = "9A4BE3D2-5E01-4B98-AA86-6B47B10CA65D";
const ACTIVITY_ID = `healthkit:${UUID}`;
const OTHER_ACTIVITY_ID = `healthkit:${OTHER_UUID}`;
const HISTORY_PATH = `user_data/activities/hist/hk_2026-08-23_${UUID}.json`;
const STREAM_PATH = `user_data/activities/streams/${UUID}.json`;
const NOW = new Date("2026-08-23T12:00:00.000Z");

function liveWeek() {
  return {
    schema_version: 1,
    data_status: "live",
    timezone: "UTC",
    week: {
      id: "2026-W34",
      start_date: "2026-08-17",
      end_date: "2026-08-23",
      focus: "Protect late-session quality.",
      guardrails: ["Keep the knee calm."],
    },
    coach_read: {
      headline: "Hold the line.",
      body: "Quality matters more than volume this week.",
      valid_from: "2026-08-17",
      valid_until: "2026-08-23",
    },
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-08-${String(17 + index).padStart(2, "0")}`,
      intent: index === 6 ? "review" : "open",
      coach_note: null,
      sessions: [],
    })),
    coach_comments: [],
    updated_at: "2026-08-23T10:00:00Z",
    updated_by: "coach",
    trace_id: "week-trace",
  };
}

function latestMessage(overrides: Partial<LatestCoachMessage> = {}): LatestCoachMessage {
  const id = overrides.id ?? "cm-existing";
  return {
    id,
    created_at: "2026-08-23T11:00:00.000Z",
    activity_ids: [ACTIVITY_ID],
    body: "You held that together late. That's the part I noticed.",
    conversation_seed_id: `local-proactive-${id}`,
    ...overrides,
  };
}

function latestFile(message: LatestCoachMessage | null): string {
  return JSON.stringify({ schema_version: 1, message });
}

function repoFiles(): Map<string, string> {
  return new Map([
    [
      HISTORY_PATH,
      JSON.stringify({
        id: UUID,
        id_str: UUID,
        source: "healthkit",
        name: "Ride #12",
        sport_type: "Ride",
        start_date_local: "2026-08-23T08:00:00+01:00",
        elapsed_time: 3_600,
        moving_time: 3_500,
        calories: 620,
        distance: 22_000,
        total_elevation_gain: 210,
        average_heartrate: 148,
        max_heartrate: 178,
        has_heartrate: true,
        hr_zones: {
          "Zone 2": { low: 132, high: 145, seconds: 1_400 },
          "Zone 4": { low: 159, high: 172, seconds: 420 },
        },
        vs_usual: {
          duration_median_s: 3_000,
          avg_hr_median: 145,
          above_threshold_median_s: 380,
        },
        description: "Controlled ride.",
        hr_stream: [{ time: 0, heartrate: 998 }],
      }),
    ],
    [
      STREAM_PATH,
      JSON.stringify({
        schema_version: 1,
        activity_id: UUID,
        elapsed_seconds: 3_600,
        source_sample_count: 321,
        covered_seconds: 3_420,
        uncovered_seconds: 180,
        effort_shape: [
          {
            start_seconds: 0,
            end_seconds: 300,
            median_bpm: 142,
            p90_bpm: 158,
            dominant_zone: "Zone 2",
            covered_seconds: 280,
          },
        ],
        points: [{ t: 0, bpm: 999 }],
      }),
    ],
    ["user_data/coach/profile.json", JSON.stringify({ name: "Sky", timezone: "Europe/London" })],
    [
      "user_data/coach/memory.json",
      JSON.stringify({
        sports: ["badminton", "cycling"],
        notes: {
          coaching_priorities: { text: "Protect the court anchors." },
          "learned_patterns.training": { text: "Late quality matters." },
          "learned_patterns.nutrition": { text: "Fuel early." },
          "learned_patterns.mental": { text: "Responds to direct questions." },
        },
      }),
    ],
    [
      "gen/athlete_insights.json",
      JSON.stringify({
        generated_at: "2026-08-23T11:55:00Z",
        window_days: 365,
        sports: {
          cycling: {
            sessions_365d: 24,
            sessions_per_week_recent_4w: 1.5,
            sessions_per_week_prior_12w: 1,
            longest_gap_days_365d: 18,
            days_since_last_session: 0,
          },
        },
      }),
    ],
    ["user_data/ledger/current_week.json", JSON.stringify(liveWeek())],
    [
      "user_data/coach/injuries.json",
      JSON.stringify({
        flags: [
          {
            id: "knee",
            text: "Left knee tender",
            status: "active",
            opened_at: "2026-08-20",
          },
          {
            id: "back",
            text: "Back settled",
            status: "resolved",
            opened_at: "2026-07-01",
          },
        ],
      }),
    ],
    [
      "user_data/coach/coach_log.json",
      JSON.stringify({
        rows: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-08-${String(17 + index).padStart(2, "0")}`,
          text: `Continuity ${index}`,
        })),
      }),
    ],
  ]);
}

function dependencies(overrides: Partial<CoachMessageDependencies> = {}): CoachMessageDependencies {
  const files = repoFiles();
  return {
    readFile: vi.fn(async (path: string) =>
      path === "user_data/coach/latest_message.json" ? latestFile(null) : (files.get(path) ?? null),
    ),
    listActivityFiles: vi.fn(async () => [
      { name: HISTORY_PATH.split("/").at(-1)!, path: HISTORY_PATH },
    ]),
    generateBody: vi.fn(async () => "You held that together late. That's the part I noticed."),
    commitFiles: vi.fn(async (writes: FileEntry[]) => {
      for (const write of writes) {
        if ("resolve" in write) await write.resolve();
      }
      return { commitSha: "commit-sha" };
    }),
    soul: "Coach soul",
    now: () => NOW,
    randomUUID: () => "new-message",
    ...overrides,
  };
}

describe("activity id request validation", () => {
  it("accepts a non-empty sorted source-qualified batch", () => {
    expect(
      validateActivityIdsPayload({
        activity_ids: [ACTIVITY_ID, "strava:12345"],
      }),
    ).toEqual([ACTIVITY_ID, "strava:12345"]);
  });

  it.each([
    [{ activity_ids: [] }, "between 1"],
    [{ activity_ids: ["strava:2", ACTIVITY_ID] }, "unique and sorted"],
    [{ activity_ids: [ACTIVITY_ID, ACTIVITY_ID] }, "unique and sorted"],
    [{ activity_ids: [ACTIVITY_ID], metrics: { fatigue: true } }, "only activity_ids"],
    [{ activity_ids: [`healthkit:${UUID.toLowerCase()}`] }, "canonical"],
    [{ activity_ids: ["chat:abc"] }, "canonical"],
  ])("rejects malformed payload %#", (payload, message) => {
    expect(() => validateActivityIdsPayload(payload)).toThrow(message);
  });

  it("rejects a batch above the explicit bound", () => {
    const ids = Array.from(
      { length: MAX_ACTIVITY_IDS + 1 },
      (_, index) => `strava:${String(index + 1).padStart(3, "0")}`,
    );
    expect(() => validateActivityIdsPayload({ activity_ids: ids })).toThrow(
      `between 1 and ${MAX_ACTIVITY_IDS}`,
    );
  });

  it("rejects invalid JSON and an oversized transport body", async () => {
    await expect(
      parseActivityIdsRequest(new Request("https://coach.test", { method: "POST", body: "{" })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      parseActivityIdsRequest(
        new Request("https://coach.test", {
          method: "POST",
          body: JSON.stringify({
            activity_ids: [ACTIVITY_ID],
            padding: "x".repeat(17_000),
          }),
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});

describe("Git activity-tree projection", () => {
  it("retains a direct history blob beyond the Contents API's 1,000-entry limit", () => {
    const tree = Array.from({ length: 1_001 }, (_, index) => ({
      path: `user_data/activities/hist/activity_${index}.json`,
      type: "blob",
    }));
    tree.push(
      {
        path: "user_data/activities/hist/nested/ignored.json",
        type: "blob",
      },
      { path: "user_data/activities/hist/not-a-blob", type: "tree" },
    );

    const projected = parseActivityHistoryTree({ truncated: false, tree });
    expect(projected).toHaveLength(1_001);
    expect(projected[1_000]).toEqual({
      name: "activity_1000.json",
      path: "user_data/activities/hist/activity_1000.json",
    });
  });

  it("fails closed when GitHub marks the recursive tree as truncated", () => {
    expect(() => parseActivityHistoryTree({ truncated: true, tree: [] })).toThrow(
      "GitHub activity tree was truncated",
    );
  });
});

describe("prompt context", () => {
  it("uses authoritative projections and never includes raw HR points", async () => {
    const deps = dependencies();
    const context = await loadProactiveContext([ACTIVITY_ID], deps, NOW);
    const prompt = buildProactivePrompt("Coach soul", context);

    expect(context.activity_batch[0]).toMatchObject({
      activity_id: ACTIVITY_ID,
      activity: {
        sport_type: "Ride",
        average_heartrate: 148,
        vs_usual: { avg_hr_median: 145 },
      },
      heart_rate_summary: {
        uncovered_seconds: 180,
        effort_shape: [{ median_bpm: 142, covered_seconds: 280 }],
      },
    });
    expect(context.athlete).toEqual({
      name: "Sky",
      sports: ["badminton", "cycling"],
      coaching_priorities: "Protect the court anchors.",
      learned_patterns: {
        training: "Late quality matters.",
        nutrition: "Fuel early.",
        mental: "Responds to direct questions.",
      },
    });
    expect(context.active_injuries).toHaveLength(1);
    expect(context.recent_coach_continuity).toHaveLength(5);
    expect(context.previous_proactive_message).toBeNull();
    expect(context.athlete_insights).toMatchObject({
      sports: { cycling: { sessions_365d: 24 } },
    });
    expect(context.current_live_week).toMatchObject({
      week: {
        focus: "Protect late-session quality.",
        guardrails: ["Keep the knee calm."],
      },
      days: expect.arrayContaining([expect.objectContaining({ intent: "review" })]),
    });
    expect(prompt).toContain('"effort_shape"');
    expect(prompt).not.toContain('"points"');
    expect(prompt).not.toContain('"hr_stream"');
    expect(prompt).not.toContain("998");
    expect(prompt).not.toContain("999");
    expect(prompt).toContain("Never sum activity durations");
    expect(prompt).toContain("Do not invent a cause");
    expect(prompt).toContain("causal story about waiting");
    expect(prompt).toContain("missing result");
    expect(prompt).toContain("remaining sensor");
  });

  it("keeps seven compact actual-schema scenarios in one weighted constant", () => {
    expect(PROACTIVE_FEW_SHOT_PAIRS.map((example) => example.scenario)).toEqual([
      "quiet_recognition",
      "missing_or_partial_hr",
      "batch_day_not_sum",
      "unusual_hr_cause_neutral_question",
      "easy_work",
      "first_controlled_new_block_work",
      "genuinely_heavy_work",
    ]);
    for (const example of PROACTIVE_FEW_SHOT_PAIRS) {
      expect(validateGeneratedBody(example.output.body)).toBe(example.output.body);
      expect(example.output.body).not.toContain("—");
      expect(JSON.stringify(example.input).length).toBeLessThan(1_600);
    }
    expect(PROACTIVE_FEW_SHOT_PAIRS[0].weight).toBeGreaterThan(
      Math.max(...PROACTIVE_FEW_SHOT_PAIRS.slice(1).map(({ weight }) => weight)),
    );
  });

  it("represents quiet-repeat and pre-result uncertainty without C8 or C9 fields", () => {
    const quiet = PROACTIVE_FEW_SHOT_PAIRS[0];
    const heavy = PROACTIVE_FEW_SHOT_PAIRS.at(-1)!;
    expect(quiet.input.previous_proactive_message?.body).toBeTruthy();
    expect(quiet.output.body).not.toBe(quiet.input.previous_proactive_message?.body);
    expect(heavy.output.body).toContain("I do not have the result");
    expect(heavy.input.activity_batch[0].activity).not.toHaveProperty("description");
    const examples = JSON.stringify(PROACTIVE_FEW_SHOT_PAIRS);
    expect(examples).not.toContain("days_since_last_same_sport");
    expect(examples).not.toContain("occurrences");
    expect(examples).not.toContain('"C8"');
    expect(examples).not.toContain('"C9"');
  });
});

describe("generated message validation", () => {
  it("accepts a bounded 1-3 sentence paragraph", () => {
    expect(
      validateGeneratedBody(
        "That one looked heavy. Don't fix it from the numbers yet. Tell me what felt off.",
      ),
    ).toContain("looked heavy");
  });

  it.each([
    ["", "one paragraph"],
    ["One. Two. Three. Four.", "1-3 short sentences"],
    ["One line.\nSecond line.", "one paragraph"],
    ["A".repeat(361), "one paragraph"],
    ["That was honest work — and I saw it.", "must not contain an em dash"],
  ])("rejects invalid output %#", (body, message) => {
    expect(() => validateGeneratedBody(body)).toThrow(message);
  });

  it("uses a message-only Gemini schema", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.responseSchema).toEqual({
        type: "object",
        properties: { body: { type: "string" } },
        required: ["body"],
      });
      expect(JSON.stringify(body)).not.toContain("file_updates");
      return Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ body: "That looked controlled." }) }],
            },
          },
        ],
      });
    });
    await expect(generateProactiveBody("key", "prompt", fetcher)).resolves.toBe(
      "That looked controlled.",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("sends the API key as a header, never in the URL (issue #638)", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ body: "Good work." }) }] } }],
      }),
    );

    await generateProactiveBody("test-api-key", "prompt", fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).not.toContain("key=");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "test-api-key" });
  });
});

describe("idempotency and resolved writes", () => {
  it("returns an existing identical batch without generation or a write", async () => {
    const existing = latestMessage();
    const deps = dependencies({
      readFile: vi.fn(async (path: string) =>
        path === "user_data/coach/latest_message.json"
          ? latestFile(existing)
          : (repoFiles().get(path) ?? null),
      ),
    });
    const result = await generateAndStoreCoachMessage([ACTIVITY_ID], deps);
    expect(result).toEqual({
      message: existing,
      commitSha: null,
      idempotent: true,
      shouldNotify: false,
    });
    expect(deps.generateBody).not.toHaveBeenCalled();
    expect(deps.commitFiles).not.toHaveBeenCalled();
  });

  it("notifies only when this request's candidate becomes durable", async () => {
    const result = await generateAndStoreCoachMessage([ACTIVITY_ID], dependencies());
    expect(result).toMatchObject({
      message: { id: "cm-new-message", activity_ids: [ACTIVITY_ID] },
      commitSha: "commit-sha",
      idempotent: false,
      shouldNotify: true,
    });
  });

  it("uses the prior body for phrasing but still writes a different same-day batch", async () => {
    const previous = latestMessage({
      activity_ids: [OTHER_ACTIVITY_ID],
      body: "A unique prior phrase from this morning.",
    });
    const files = repoFiles();
    const generateBody = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('"previous_proactive_message"');
      expect(prompt).toContain(previous.body);
      return "This different batch gets its own grounded message.";
    });
    const deps = dependencies({
      readFile: vi.fn(async (path: string) =>
        path === "user_data/coach/latest_message.json"
          ? latestFile(previous)
          : (files.get(path) ?? null),
      ),
      generateBody,
    });

    const result = await generateAndStoreCoachMessage([ACTIVITY_ID], deps);

    expect(generateBody).toHaveBeenCalledOnce();
    expect(deps.commitFiles).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      message: { activity_ids: [ACTIVITY_ID] },
      idempotent: false,
      shouldNotify: true,
    });
  });

  it("preserves an identical durable winner found by the resolver", async () => {
    const existing = latestMessage();
    let latestReads = 0;
    const files = repoFiles();
    const deps = dependencies({
      readFile: vi.fn(async (path: string) => {
        if (path !== "user_data/coach/latest_message.json") {
          return files.get(path) ?? null;
        }
        latestReads += 1;
        return latestReads === 1 ? latestFile(null) : latestFile(existing);
      }),
    });
    const result = await generateAndStoreCoachMessage([ACTIVITY_ID], deps);
    expect(result.message).toEqual(existing);
    expect(result.idempotent).toBe(true);
    expect(result.shouldNotify).toBe(false);
    expect(result.commitSha).toBe("commit-sha");
  });

  it("re-reads on retry and preserves a newer durable winner", async () => {
    const newer = latestMessage({
      id: "cm-newer",
      created_at: "2026-08-23T12:01:00.000Z",
      activity_ids: [OTHER_ACTIVITY_ID],
      conversation_seed_id: "local-proactive-cm-newer",
    });
    let latestReads = 0;
    const files = repoFiles();
    const commitFiles = vi.fn(async (writes: FileEntry[]) => {
      const resolved = writes[0];
      if (!("resolve" in resolved)) throw new Error("expected resolved write");
      await resolved.resolve();
      await resolved.resolve();
      return { commitSha: "retry-sha" };
    });
    const deps = dependencies({
      readFile: vi.fn(async (path: string) => {
        if (path !== "user_data/coach/latest_message.json") {
          return files.get(path) ?? null;
        }
        latestReads += 1;
        if (latestReads < 3) return latestFile(null);
        return latestFile(newer);
      }),
      commitFiles,
    });
    const result = await generateAndStoreCoachMessage([ACTIVITY_ID], deps);
    expect(latestReads).toBe(3);
    expect(result.message).toEqual(newer);
    expect(result.commitSha).toBe("retry-sha");
    expect(result.idempotent).toBe(false);
    expect(result.shouldNotify).toBe(false);
  });
});

describe("failure safety", () => {
  it("does not write when generation fails", async () => {
    const commitFiles = vi.fn();
    const deps = dependencies({
      generateBody: vi.fn(async () => {
        throw new CoachMessageError("Gemini unavailable", 502);
      }),
      commitFiles,
    });
    await expect(generateAndStoreCoachMessage([ACTIVITY_ID], deps)).rejects.toThrow(
      "Gemini unavailable",
    );
    expect(commitFiles).not.toHaveBeenCalled();
  });

  it("does not return a generated body when the atomic write fails", async () => {
    const deps = dependencies({
      commitFiles: vi.fn(async (writes: FileEntry[]) => {
        const write = writes[0];
        if ("resolve" in write) await write.resolve();
        throw new Error("GitHub conflict exhausted");
      }),
    });
    await expect(generateAndStoreCoachMessage([ACTIVITY_ID], deps)).rejects.toThrow(
      "GitHub conflict exhausted",
    );
  });

  it("fails before generation when the authoritative activity is absent", async () => {
    const deps = dependencies({ listActivityFiles: vi.fn(async () => []) });
    await expect(generateAndStoreCoachMessage([ACTIVITY_ID], deps)).rejects.toMatchObject({
      status: 422,
    });
    expect(deps.generateBody).not.toHaveBeenCalled();
    expect(deps.commitFiles).not.toHaveBeenCalled();
  });
});
