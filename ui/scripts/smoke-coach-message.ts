#!/usr/bin/env -S npx tsx
/**
 * smoke-coach-message.ts — the live-model canary for coach-message. It builds one real proactive
 * prompt and sends it through **both** adapters (`selectLlmAdapter`, #713), then holds each reply
 * to the same contract production holds it to: parseable JSON, exactly `{body}`, and a body that
 * survives `validateGeneratedBody`.
 *
 * Why it exists: nothing else in the suite touches a real model, so a Google-side change to
 * thinking mode broke production in silence (#827). Every other test mocks the provider, which is
 * exactly why none of them could see it.
 *
 * This is a paid check. ADR 0024 governs when paid checks run; the gate for this one is a
 * schedule, not a diff — see `kdb/decisions/0037-scheduled-canaries-catch-upstream-drift.md`.
 * Do not wire it to a pull request.
 *
 * Assertions live in exported functions rather than inline, so `ui/api/_lib/_tests/
 * smokeCoachMessage.test.ts` can exercise them against fake replies. The live call is the
 * workflow's job; `npm test` stays free and deterministic.
 *
 * Usage (from ui/):
 *   npx tsx --tsconfig tsconfig.json scripts/smoke-coach-message.ts
 *
 * Needs GEMINI_API_KEY and OPENROUTER_API_KEY in ui/.env.local or the environment. A missing key
 * is a hard failure naming the key: a canary that quietly tests nothing is worse than no canary.
 *
 * Exit codes follow eval-coach-chat.ts: 1 = a reply genuinely failed the contract (or a key is
 * missing), 2 = the call never completed, which says nothing about the model.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SOUL } from "../api/_generated/soul.js";
import { selectLlmAdapter, type LlmProviderName } from "../api/_lib/llmClient.js";
import {
  PROACTIVE_MAX_OUTPUT_TOKENS,
  PROACTIVE_RESPONSE_SCHEMA,
  buildProactivePrompt,
  loadProactiveContext,
  parseLatestMessageFile,
  validateGeneratedBody,
  type ActivityFileEntry,
  type ProactiveContext,
} from "../api/coach-message/_lib/coachMessage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const UI_ROOT = path.resolve(__dirname, "..");

/** Both adapters, and the key each one cannot run without. */
export const ADAPTER_KEYS: Record<LlmProviderName, string> = {
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const RETRY_DELAY_MS = 2_000;
const EXCERPT_CHARS = 200;

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * `truncated` — the model stopped mid-reply. `unparseable` — it finished, but not with JSON.
 * `schema` — it produced JSON that is not the `{body}` contract, or a body production would
 * reject. `transport` — the call never completed; this says nothing about model behaviour.
 */
export type SmokeFailureKind = "truncated" | "unparseable" | "schema" | "transport";

/** A named, actionable failure: which adapter, which kind, and the evidence. A red run has to be
 * readable without paying for a second one. */
export class SmokeFailure extends Error {
  constructor(
    readonly adapter: string,
    readonly kind: SmokeFailureKind,
    readonly reason: string,
    readonly evidence: string | null = null,
  ) {
    super(
      `[${adapter}] ${kind}: ${reason}` +
        (evidence ? `\n    raw reply (first ${EXCERPT_CHARS} chars): ${excerpt(evidence)}` : ""),
    );
    this.name = "SmokeFailure";
  }
}

function excerpt(text: string): string {
  return text.length <= EXCERPT_CHARS ? text : `${text.slice(0, EXCERPT_CHARS)}…`;
}

/**
 * Is this text a JSON *prefix* rather than JSON? A reply cut off by an output-token ceiling comes
 * back as a well-formed opening that never closes, so an unclosed brace, bracket, or string is
 * the difference between "the model ran out of room" and "the model wrote something that isn't
 * JSON". They need different fixes — raise the budget, versus look at the schema — so the canary
 * separates them instead of reporting both as a parse error.
 */
export function looksTruncated(text: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
  }
  return inString || depth > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Hold one raw adapter reply to production's contract and return the body it yields. Mirrors
 * `generateProactiveBody`'s checks deliberately: same JSON parse, same exactly-one-`body` shape
 * test, same `validateGeneratedBody`. If production would 502 on this reply, the canary goes red
 * on it — that equivalence is the whole point, so the checks stay in step by calling the same
 * validator, not by copying its rules.
 */
export function checkProactiveReply(adapter: string, text: string): string {
  const raw = text.trim();
  if (!raw) {
    throw new SmokeFailure(adapter, "unparseable", "the adapter returned an empty reply");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (looksTruncated(raw)) {
      throw new SmokeFailure(
        adapter,
        "truncated",
        `the reply is unterminated JSON, so the model stopped before finishing (${raw.length} chars). ` +
          `Raise the output budget (${PROACTIVE_MAX_OUTPUT_TOKENS} tokens today) or find out why thinking grew`,
        raw,
      );
    }
    throw new SmokeFailure(adapter, "unparseable", `JSON.parse rejected the reply: ${detail}`, raw);
  }
  if (!isPlainObject(parsed)) {
    throw new SmokeFailure(adapter, "schema", "the reply parsed, but not into a JSON object", raw);
  }
  const keys = Object.keys(parsed);
  if (!keys.includes("body")) {
    throw new SmokeFailure(
      adapter,
      "schema",
      `the reply has no "body" field (keys: ${keys.join(", ") || "none"})`,
      raw,
    );
  }
  if (keys.length !== 1) {
    throw new SmokeFailure(
      adapter,
      "schema",
      `the reply carries fields beyond "body" (keys: ${keys.join(", ")})`,
      raw,
    );
  }
  try {
    return validateGeneratedBody(parsed.body);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SmokeFailure(adapter, "schema", `production would reject this body: ${detail}`, raw);
  }
}

/**
 * Sort an adapter's own throw into the same kinds. The adapters catch truncation before we ever
 * see text (`MAX_TOKENS` for Gemini, `finish_reason: "length"` for OpenRouter), and an empty
 * candidate is a real model failure too. Everything else — an HTTP status, a timeout, a dropped
 * socket — is `transport`: worth retrying once, and never evidence about the model.
 */
export function classifyAdapterError(adapter: string, err: unknown): SmokeFailure {
  const message = err instanceof Error ? err.message : String(err);
  if (/truncated its response before finishing/.test(message)) {
    return new SmokeFailure(adapter, "truncated", message);
  }
  if (/returned no content/.test(message)) {
    return new SmokeFailure(adapter, "unparseable", message);
  }
  return new SmokeFailure(adapter, "transport", message);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const SMOKE_UUID = "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE";
const SMOKE_ACTIVITY_ID = `healthkit:${SMOKE_UUID}`;
const SMOKE_HISTORY_PATH = `user_data/activities/hist/hk_2026-07-19_${SMOKE_UUID}.json`;
const SMOKE_STREAM_PATH = `user_data/activities/streams/${SMOKE_UUID}.json`;

/**
 * The athlete side of the prompt. `shared/golden-dataset/` carries the fake athlete's *rendered*
 * layer — widget snapshots, a week contract, the proactive message — but no raw activity, profile,
 * memory, insight, injury, or coach-log file, which is what `loadProactiveContext` reads. So the
 * previous proactive message comes from the golden dataset (below) and the repo files it cannot
 * supply live here, matching the same athlete.
 *
 * Every value goes through the real projections, so this exercises the production path, not a
 * hand-built context object.
 */
function smokeRepoFiles(): Map<string, string> {
  return new Map([
    [
      SMOKE_HISTORY_PATH,
      JSON.stringify({
        id: SMOKE_UUID,
        id_str: SMOKE_UUID,
        source: "healthkit",
        name: "Ranked court",
        category: "badminton",
        sport_type: "Badminton",
        start_date_local: "2026-07-19T19:30:00+01:00",
        elapsed_time: 5_400,
        moving_time: 5_100,
        calories: 690,
        average_heartrate: 151,
        max_heartrate: 181,
        has_heartrate: true,
        hr_zones: {
          "Zone 2": { low: 132, high: 145, seconds: 1_500 },
          "Zone 4": { low: 159, high: 172, seconds: 900 },
        },
        vs_usual: { duration_median_s: 4_800, avg_hr_median: 148, above_threshold_median_s: 720 },
      }),
    ],
    [
      SMOKE_STREAM_PATH,
      JSON.stringify({
        schema_version: 1,
        activity_id: SMOKE_UUID,
        elapsed_seconds: 5_400,
        source_sample_count: 512,
        covered_seconds: 5_200,
        uncovered_seconds: 200,
        effort_shape: Array.from({ length: 6 }, (_, index) => ({
          start_seconds: index * 900,
          end_seconds: (index + 1) * 900,
          median_bpm: 140 + index * 3,
          p90_bpm: 158 + index * 2,
          dominant_zone: index > 3 ? "Zone 4" : "Zone 2",
          covered_seconds: 880,
        })),
      }),
    ],
    ["user_data/coach/profile.json", JSON.stringify({ name: "Sky", timezone: "Europe/London" })],
    [
      "user_data/coach/memory.json",
      JSON.stringify({
        sports: ["badminton", "cycling"],
        notes: {
          coaching_priorities: { text: "Protect the two court anchors." },
          "learned_patterns.training": { text: "Late-session quality is the tell." },
          "learned_patterns.nutrition": { text: "Fuels early on court days." },
          "learned_patterns.mental": { text: "Responds to direct questions." },
        },
      }),
    ],
    [
      "gen/athlete_insights.json",
      JSON.stringify({
        generated_at: "2026-07-19T23:55:00Z",
        window_days: 365,
        sports: {
          badminton: {
            sessions_365d: 96,
            sessions_per_week_recent_4w: 2,
            sessions_per_week_prior_12w: 1.8,
            longest_gap_days_365d: 11,
            days_since_last_session: 0,
          },
        },
      }),
    ],
    [
      "user_data/coach/injuries.json",
      JSON.stringify({
        flags: [
          { id: "knee", text: "Left knee tender", status: "active", opened_at: "2026-07-10" },
          { id: "back", text: "Back settled", status: "resolved", opened_at: "2026-05-02" },
        ],
      }),
    ],
    [
      "user_data/coach/coach_log.json",
      JSON.stringify({
        rows: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-07-${String(13 + index).padStart(2, "0")}`,
          text: `Held the anchor, day ${index + 1}.`,
        })),
      }),
    ],
  ]);
}

/**
 * The previous proactive message, read from `shared/golden-dataset/latest_message.json` through
 * the real `parseLatestMessageFile`. A schema drift in that fixture fails the canary here, before
 * any paid call.
 *
 * There is no `current_live_week` in the prompt: the golden week fixture is a frozen placeholder,
 * and the live-week gate in `loadProactiveContext` correctly resolves a placeholder to null.
 */
function goldenPreviousMessage(): ProactiveContext["previous_proactive_message"] {
  const raw = fs.readFileSync(
    path.join(REPO_ROOT, "shared", "golden-dataset", "latest_message.json"),
    "utf8",
  );
  const file = parseLatestMessageFile(raw);
  if (!file.message) {
    throw new Error(
      "smoke-coach-message: shared/golden-dataset/latest_message.json holds no message — " +
        "the canary has no previous-message context to send.",
    );
  }
  return { created_at: file.message.created_at, body: file.message.body };
}

/** Build the one prompt both adapters receive. Same input to both is the point: a difference in
 * the replies is a difference between the providers, not between two prompts. */
export async function buildSmokePrompt(now: Date = new Date()): Promise<string> {
  const files = smokeRepoFiles();
  const entries: ActivityFileEntry[] = [
    { name: SMOKE_HISTORY_PATH.split("/").at(-1)!, path: SMOKE_HISTORY_PATH },
  ];
  const context = await loadProactiveContext(
    [SMOKE_ACTIVITY_ID],
    {
      readFile: (filePath: string) => Promise.resolve(files.get(filePath) ?? null),
      listActivityFiles: () => Promise.resolve(entries),
    },
    now,
    goldenPreviousMessage(),
  );
  return buildProactivePrompt(SOUL, context);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

interface AdapterOutcome {
  adapter: LlmProviderName;
  model: string;
  resolvedProvider?: string;
  resolvedModel?: string;
  body?: string;
  failure?: SmokeFailure;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One adapter, one prompt. A transport failure is retried once: Gemini 503s
 * non-deterministically (ADR 0024), and a canary whose reds are mostly upstream weather is a
 * canary people stop reading. A contract failure is never retried — that is the signal.
 */
async function runAdapter(name: LlmProviderName, prompt: string): Promise<AdapterOutcome> {
  const adapter = selectLlmAdapter({ ...process.env, LLM_PROVIDER: name });
  let lastFailure: SmokeFailure | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await adapter.generate({
        prompt,
        maxOutputTokens: PROACTIVE_MAX_OUTPUT_TOKENS,
        responseSchema: PROACTIVE_RESPONSE_SCHEMA,
      });
      const outcome: AdapterOutcome = {
        adapter: name,
        model: result.telemetry.model,
        resolvedProvider: result.telemetry.resolvedProvider,
        resolvedModel: result.telemetry.resolvedModel,
      };
      try {
        outcome.body = checkProactiveReply(name, result.text);
      } catch (err) {
        outcome.failure = err instanceof SmokeFailure ? err : classifyAdapterError(name, err);
      }
      return outcome;
    } catch (err) {
      lastFailure = classifyAdapterError(name, err);
      if (lastFailure.kind !== "transport" || attempt === 2) break;
      console.log(`  ${name}: ${lastFailure.message} — retrying once.`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  return { adapter: name, model: adapter.model, failure: lastFailure! };
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(path.join(UI_ROOT, ".env.local"));
  } catch {
    // Fine if it does not exist — in Actions the keys arrive as environment secrets.
  }

  const missing = Object.entries(ADAPTER_KEYS)
    .filter(([, key]) => !process.env[key])
    .map(([adapter, key]) => `${key} (needed by the ${adapter} adapter)`);
  if (missing.length > 0) {
    console.error(
      `smoke-coach-message: missing required secret(s):\n  ${missing.join("\n  ")}\n` +
        "This check never skips a provider — add the secret and re-run.",
    );
    process.exit(1);
  }

  const prompt = await buildSmokePrompt();
  console.log(
    `Prompt built: ${prompt.length} chars. Calling ${Object.keys(ADAPTER_KEYS).length} adapters.`,
  );

  const outcomes: AdapterOutcome[] = [];
  for (const name of Object.keys(ADAPTER_KEYS) as LlmProviderName[]) {
    outcomes.push(await runAdapter(name, prompt));
  }

  console.log("");
  for (const outcome of outcomes) {
    const resolved = outcome.resolvedProvider
      ? ` via ${outcome.resolvedProvider}/${outcome.resolvedModel ?? "?"}`
      : "";
    if (outcome.failure) {
      console.error(`FAIL ${outcome.adapter} (${outcome.model}${resolved})`);
      console.error(`  ${outcome.failure.message}`);
    } else {
      console.log(`PASS ${outcome.adapter} (${outcome.model}${resolved})`);
      console.log(`  body: ${outcome.body}`);
    }
  }

  const failures = outcomes.flatMap((outcome) => (outcome.failure ? [outcome.failure] : []));
  if (failures.length === 0) {
    console.log(`\n${outcomes.length}/${outcomes.length} adapters returned a valid coach message.`);
    return;
  }
  // A contract failure and a transport failure mean opposite things. Only the first says the
  // model changed under us; reporting them as one number is how a canary stops being read.
  const contract = failures.filter((failure) => failure.kind !== "transport");
  console.error(
    `\n${failures.length}/${outcomes.length} adapters failed ` +
      `(${contract.length} on the reply contract, ${failures.length - contract.length} on transport).`,
  );
  process.exit(contract.length > 0 ? 1 : 2);
}

// Imported by the tests for the assertion functions above; only a direct run does the paid call.
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  await main();
}
