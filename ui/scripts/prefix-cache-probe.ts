#!/usr/bin/env -S npx tsx
/**
 * prefix-cache-probe.ts — issue #890, throwaway by design (not wired into any npm script or CI).
 *
 * Question: does an explicit OpenRouter cache_control marker earn Vertex a prefix discount on
 * `google/gemini-3.8-flash` when only the athlete tail changes, and how does that compare to the
 * DeepSeek hosts that already cache automatically? The prior bench
 * (docs/eng-docs/chat-provider-bench.md) found Vertex discounts an exact repeat of the whole
 * prompt but not a shared prefix with a new tail — production always sends a new tail, so that
 * result means production never earns a discount today. This script tests whether an explicit
 * marker changes that.
 *
 * Byte-identical prompt: uses the real `buildProactivePrompt(soul, context)` — same SOUL
 * (`ui/api/_generated/soul.ts`, built from `platform/SOUL.chat.md`), same `loadProactiveContext`
 * projections, run against a live athlete repo's real files (not a fixture) via a local
 * `readFile`/`listActivityFiles` pair that reads the sibling `coach-akash` checkout directly
 * instead of the GitHub Data API `ui/api/coach-message.ts` uses in production. The prompt text
 * that reaches the model is exactly what `buildProactivePrompt` returns — this script only
 * decides how many pieces to split it into on the wire (see arm B below), never what the pieces
 * say.
 *
 * Four arms, one call per real activity id, so the <athlete_context> tail genuinely varies call
 * to call the way production's does — an identical repeat would report a discount production
 * never receives (docs/eng-docs/chat-provider-bench.md's Gotchas):
 *
 *   A. OpenRouter -> Vertex Gemini, single string content — production's exact request shape
 *      (`ui/api/_lib/llmAdapters/openRouterAdapter.ts`), sent through `usage: {include: true}` so
 *      `cached_tokens` and `cost` come back on the wire.
 *   B. Same model and prompt, but content is split at the athlete_context boundary into two
 *      parts, the first (the stable prefix — soul, instructions, few-shots) carrying
 *      `cache_control: {type: "ephemeral"}`. That is OpenRouter's documented, provider-agnostic
 *      prompt-caching breakpoint syntax; whether Vertex actually honors it for Gemini is what's
 *      untested.
 *   C. `deepseek/deepseek-v4-flash` pinned to Venice only, single string content.
 *   D. `deepseek/deepseek-v4-flash` pinned to Parasail only, single string content.
 *
 * Pin the provider explicitly (`only`, not the model's default routing) or the same prompt reads
 * 2s to 59s because OpenRouter spreads one DeepSeek model across 15 hosts — that measures routing,
 * not the model (same Gotcha).
 *
 * Needs OPENROUTER_API_KEY in ui/.env.local or env. Run from ui/:
 *   npx tsx --tsconfig tsconfig.json scripts/prefix-cache-probe.ts
 *
 * Real money: 4 arms x 6 calls = 24 live calls, each a few cents at most per the prior bench.
 */
import { readFile as fsReadFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SOUL } from "../api/_generated/soul.js";
import {
  loadProactiveContext,
  buildProactivePrompt,
  PROACTIVE_RESPONSE_SCHEMA,
  type ActivityFileEntry,
} from "../api/coach-message/_lib/coachMessage.js";

const uiRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(uiRoot, ".env.local"));
} catch {
  // fine — OPENROUTER_API_KEY may already be in the environment
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error(
    "[prefix-cache-probe] OPENROUTER_API_KEY not set (env or ui/.env.local) — cannot run live.",
  );
  process.exit(1);
}

// A live athlete repo checkout, same kind the prior bench measured against (its Method note:
// "against a live athlete repo, not a fixture"). Required, not defaulted to a sibling path — this
// script runs from whatever worktree it was checked out into, which usually isn't next to any
// athlete repo, so guessing a path would silently read the wrong (or no) files.
const ATHLETE_REPO = process.env.ATHLETE_REPO_PATH;
if (!ATHLETE_REPO) {
  console.error(
    "[prefix-cache-probe] Set ATHLETE_REPO_PATH to a local athlete repo checkout (e.g. coach-akash).",
  );
  process.exit(1);
}

async function readFile(relPath: string): Promise<string | null> {
  try {
    return await fsReadFile(path.join(ATHLETE_REPO, relPath), "utf8");
  } catch {
    return null;
  }
}

async function listActivityFiles(): Promise<ActivityFileEntry[]> {
  const dir = path.join(ATHLETE_REPO, "user_data/activities/hist");
  const names = await readdir(dir);
  return names.map((name) => ({ name, path: `user_data/activities/hist/${name}` }));
}

// Six distinct, real HealthKit activities from the athlete repo — one per call, so the
// <athlete_context> tail is genuinely different every time, the way a real sync is.
const ACTIVITY_IDS = [
  "healthkit:9251060E-1AE2-4FFA-87B9-7835DCA48F36",
  "healthkit:C8E4F9F2-FDDB-4F43-AB63-312CDE11873D",
  "healthkit:079608A5-6A9E-4064-B439-AC151596A751",
  "healthkit:2D3A3E82-C153-426C-8CAE-62E9F1D58F14",
  "healthkit:B12F417D-C1DB-4055-9D4F-EC9C5D419531",
  "healthkit:3F0470B0-88F9-49AF-B60D-1D5076A8A440",
];

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Same ceiling as production (`PROACTIVE_MAX_OUTPUT_TOKENS` in coachMessage.ts) — not exported,
// duplicated here as a constant rather than reaching into the module's private scope.
const MAX_OUTPUT_TOKENS = 3_072;

interface CallResult {
  ok: boolean;
  status: number;
  promptTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  cost?: number;
  provider?: string;
  latencyMs: number;
  error?: string;
}

async function callOpenRouter(body: Record<string, unknown>): Promise<CallResult> {
  const start = Date.now();
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - start;
  const payload = (await response.json()) as {
    error?: { message?: string };
    provider?: string;
    usage?: {
      prompt_tokens?: number;
      cost?: number;
      prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    };
  };
  if (!response.ok || payload.error) {
    return {
      ok: false,
      status: response.status,
      latencyMs,
      error: payload.error?.message ?? `HTTP ${response.status}`,
    };
  }
  return {
    ok: true,
    status: response.status,
    latencyMs,
    provider: payload.provider,
    promptTokens: payload.usage?.prompt_tokens,
    cachedTokens: payload.usage?.prompt_tokens_details?.cached_tokens,
    cacheWriteTokens: payload.usage?.prompt_tokens_details?.cache_write_tokens,
    cost: payload.usage?.cost,
  };
}

function geminiRequestBody(content: unknown): Record<string, unknown> {
  return {
    model: "google/gemini-3.8-flash",
    messages: [{ role: "user", content }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: PROACTIVE_RESPONSE_SCHEMA.name,
        strict: true,
        schema: PROACTIVE_RESPONSE_SCHEMA.schema,
      },
    },
    max_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: "low" },
    usage: { include: true },
    provider: { only: ["google-vertex"], require_parameters: true, data_collection: "deny" },
  };
}

function deepseekRequestBody(prompt: string, provider: string): Record<string, unknown> {
  return {
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: PROACTIVE_RESPONSE_SCHEMA.name,
        strict: true,
        schema: PROACTIVE_RESPONSE_SCHEMA.schema,
      },
    },
    max_tokens: MAX_OUTPUT_TOKENS,
    usage: { include: true },
    provider: { only: [provider], require_parameters: true, data_collection: "deny" },
  };
}

/**
 * Splits the real prompt at the `<athlete_context>` boundary. Concatenating the two halves
 * reproduces the original string exactly — this only decides where a cache_control breakpoint
 * lands, never what text is sent.
 */
function splitAtAthleteContext(prompt: string): { prefix: string; tail: string } {
  const marker = "<athlete_context>";
  const idx = prompt.indexOf(marker);
  if (idx === -1) throw new Error("prompt has no <athlete_context> marker — did the shape change?");
  return { prefix: prompt.slice(0, idx), tail: prompt.slice(idx) };
}

async function main() {
  console.log(`[prefix-cache-probe] athlete repo: ${ATHLETE_REPO}`);

  const prompts: string[] = [];
  for (const activityId of ACTIVITY_IDS) {
    const context = await loadProactiveContext(
      [activityId],
      { readFile, listActivityFiles },
      new Date(),
    );
    prompts.push(buildProactivePrompt(SOUL, context));
  }
  const { prefix } = splitAtAthleteContext(prompts[0]);
  console.log(
    `[prefix-cache-probe] stable prefix length: ${prefix.length} chars across ${prompts.length} calls`,
  );

  const results: Record<string, CallResult[]> = {
    A_no_marker: [],
    B_marker: [],
    C_venice: [],
    D_parasail: [],
  };

  console.log("\n=== Arm A: OpenRouter -> Vertex Gemini, no marker ===");
  for (const prompt of prompts) {
    const result = await callOpenRouter(geminiRequestBody(prompt));
    results.A_no_marker.push(result);
    console.log(result);
  }

  console.log("\n=== Arm B: OpenRouter -> Vertex Gemini, explicit cache_control marker ===");
  for (const prompt of prompts) {
    const { prefix: stablePrefix, tail } = splitAtAthleteContext(prompt);
    const content = [
      { type: "text", text: stablePrefix, cache_control: { type: "ephemeral" } },
      { type: "text", text: tail },
    ];
    const result = await callOpenRouter(geminiRequestBody(content));
    results.B_marker.push(result);
    console.log(result);
  }

  console.log("\n=== Arm C: DeepSeek v4 Flash, pinned Venice ===");
  for (const prompt of prompts) {
    const result = await callOpenRouter(deepseekRequestBody(prompt, "Venice"));
    results.C_venice.push(result);
    console.log(result);
  }

  console.log("\n=== Arm D: DeepSeek v4 Flash, pinned Parasail ===");
  for (const prompt of prompts) {
    const result = await callOpenRouter(deepseekRequestBody(prompt, "Parasail"));
    results.D_parasail.push(result);
    console.log(result);
  }

  console.log("\n=== Summary ===");
  for (const [arm, calls] of Object.entries(results)) {
    const ok = calls.filter((c) => c.ok);
    const cachedPct = ok.map((c) =>
      c.promptTokens ? ((c.cachedTokens ?? 0) / c.promptTokens) * 100 : 0,
    );
    const costs = ok.map((c) => c.cost ?? 0);
    console.log(
      `${arm}: ${ok.length}/${calls.length} ok, cached% per call: [${cachedPct.map((p) => p.toFixed(1)).join(", ")}], cost per call: [${costs.map((c) => `$${c.toFixed(4)}`).join(", ")}]`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
