// Unit tests for the pure computation functions in `sentry-digest.mjs` — no live Sentry calls,
// no network. Row fixtures use the exact Discover API field keys the real code requests (see the
// `fields: [...]` arrays in `operationsUrl`, `tokensUrl`, `athleteTokensUrl` in that file) — not
// invented shapes. Importing the module itself makes no network call and needs no Sentry token:
// see the `isMain` guard around `readToken()`/`main()` there.
//
// Run directly: `node --test platform/skills/sentry-digest.test.mjs`
// Run via the repo gate: `bash platform/scripts/check.sh` (see `platform/scripts/checks.conf`).

import assert from "node:assert/strict";
import { test, describe } from "node:test";

import {
  operationStats,
  tokenStats,
  athleteTokenStats,
  trendStats,
  trendDirection,
  resolveStale,
  formatCost,
} from "./sentry-digest.mjs";

describe("operationStats", () => {
  test("empty window returns no rows", () => {
    assert.deepEqual(operationStats([]), []);
  });

  test("single operation, single outcome", () => {
    const rows = [{ operation: "coach-chat", outcome: "ok", "count()": "5" }];
    assert.deepEqual(operationStats(rows), [{ operation: "coach-chat", ok: 5, error: 0, calls: 5 }]);
  });

  test("folds the ok/error rows per operation and sorts by call volume descending", () => {
    const rows = [
      { operation: "coach-chat", outcome: "ok", "count()": "3" },
      { operation: "coach-chat", outcome: "error", "count()": "2" },
      { operation: "repo-file", outcome: "ok", "count()": "10" },
    ];
    assert.deepEqual(operationStats(rows), [
      { operation: "repo-file", ok: 10, error: 0, calls: 10 },
      { operation: "coach-chat", ok: 3, error: 2, calls: 5 },
    ]);
  });

  test("untagged operation and unrecognized outcome", () => {
    // A row with no `operation` field falls back to "(untagged)"; an outcome that is neither
    // "ok" nor "error" (e.g. a value from an unrelated span) counts toward neither bucket, only
    // `calls` via the ok+error sum — so it is silently dropped from the total, which is the
    // current, deliberate behavior of the two-armed `if/else if`.
    const rows = [{ outcome: "ok", "count()": "1" }, { operation: "x", outcome: "cancelled", "count()": "4" }];
    const stats = operationStats(rows);
    assert.deepEqual(stats.find((s) => s.operation === "(untagged)"), {
      operation: "(untagged)",
      ok: 1,
      error: 0,
      calls: 1,
    });
    assert.deepEqual(stats.find((s) => s.operation === "x"), { operation: "x", ok: 0, error: 0, calls: 0 });
  });
});

describe("tokenStats", () => {
  test("empty window returns no rows", () => {
    assert.deepEqual(tokenStats([], []), []);
  });

  test("single model, no cost rows at all -> no pricing data", () => {
    const tokenRows = [
      {
        "gen_ai.request.model": "gemini-pro-latest",
        "sum(gen_ai.usage.input_tokens)": "1000",
        "sum(gen_ai.usage.output_tokens)": "200",
        "sum(gen_ai.usage.total_tokens)": "1200",
        "count()": "4",
      },
    ];
    const stats = tokenStats(tokenRows, []);
    assert.equal(stats.length, 1);
    assert.deepEqual(stats[0], {
      model: "gemini-pro-latest",
      calls: 4,
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      costUsd: null,
      estimated: false,
    });
  });

  test("multiple models: real billed cost, estimated cost, and no pricing data side by side", () => {
    const tokenRows = [
      {
        "gen_ai.request.model": "google/gemini-3.8-flash",
        "sum(gen_ai.usage.input_tokens)": "11443",
        "sum(gen_ai.usage.output_tokens)": "44",
        "sum(gen_ai.usage.total_tokens)": "11487",
        "count()": "1",
      },
      {
        "gen_ai.request.model": "gemini-pro-latest",
        "sum(gen_ai.usage.input_tokens)": "1000000",
        "sum(gen_ai.usage.output_tokens)": "500000",
        "sum(gen_ai.usage.total_tokens)": "1500000",
        "count()": "23",
      },
      {
        "gen_ai.request.model": "untracked-model",
        "sum(gen_ai.usage.input_tokens)": "500",
        "sum(gen_ai.usage.output_tokens)": "0",
        "sum(gen_ai.usage.total_tokens)": "500",
        "count()": "1",
      },
    ];
    // Only the OpenRouter model reports a real, billed cost.usd span (per `costUrl`'s comment).
    const costRows = [{ "gen_ai.request.model": "google/gemini-3.8-flash", "gen_ai.usage.cost.usd": "0.0094" }];
    // `gemini-pro-latest` has a pricing table entry so it estimates from tokens; `untracked-model`
    // has neither a billed cost nor a pricing entry, so it must report "no pricing data".
    const pricingTable = { "gemini-pro-latest": { input: 1, output: 2 } };

    const stats = tokenStats(tokenRows, costRows, pricingTable);
    const byModel = Object.fromEntries(stats.map((s) => [s.model, s]));

    assert.deepEqual(byModel["google/gemini-3.8-flash"], {
      model: "google/gemini-3.8-flash",
      calls: 1,
      inputTokens: 11443,
      outputTokens: 44,
      totalTokens: 11487,
      costUsd: 0.0094,
      estimated: false,
    });

    assert.equal(byModel["gemini-pro-latest"].estimated, true);
    // (1_000_000 / 1e6) * 1 + (500_000 / 1e6) * 2 = 1 + 1 = 2
    assert.equal(byModel["gemini-pro-latest"].costUsd, 2);

    assert.deepEqual(byModel["untracked-model"], {
      model: "untracked-model",
      calls: 1,
      inputTokens: 500,
      outputTokens: 0,
      totalTokens: 500,
      costUsd: null,
      estimated: false,
    });

    // Sorted by totalTokens descending.
    assert.deepEqual(stats.map((s) => s.model), [
      "gemini-pro-latest",
      "google/gemini-3.8-flash",
      "untracked-model",
    ]);
  });

  test("multiple cost rows for the same model are summed before comparing to token rows", () => {
    const tokenRows = [
      {
        "gen_ai.request.model": "google/gemini-3.8-flash",
        "sum(gen_ai.usage.input_tokens)": "100",
        "sum(gen_ai.usage.output_tokens)": "50",
        "sum(gen_ai.usage.total_tokens)": "150",
        "count()": "2",
      },
    ];
    const costRows = [
      { "gen_ai.request.model": "google/gemini-3.8-flash", "gen_ai.usage.cost.usd": "0.01" },
      { "gen_ai.request.model": "google/gemini-3.8-flash", "gen_ai.usage.cost.usd": "0.02" },
    ];
    const stats = tokenStats(tokenRows, costRows);
    assert.equal(stats[0].costUsd, 0.03);
    assert.equal(stats[0].estimated, false);
  });
});

describe("athleteTokenStats", () => {
  test("empty window returns no rows", () => {
    assert.deepEqual(athleteTokenStats([], []), []);
  });

  test("one athlete, one model, no cost data -> no pricing data", () => {
    const tokenRows = [
      {
        "user.id": "akash-suresh",
        "gen_ai.request.model": "gemini-pro-latest",
        "sum(gen_ai.usage.input_tokens)": "100",
        "sum(gen_ai.usage.output_tokens)": "20",
        "sum(gen_ai.usage.total_tokens)": "120",
        "count()": "1",
      },
    ];
    const stats = athleteTokenStats(tokenRows, []);
    assert.deepEqual(stats, [
      { athlete: "akash-suresh", calls: 1, totalTokens: 120, costUsd: null, estimated: false },
    ]);
  });

  test("folds multiple models per athlete, marking estimated if any of their calls were", () => {
    const tokenRows = [
      {
        "user.id": "shreyas-95-cyber",
        "gen_ai.request.model": "google/gemini-3.8-flash",
        "sum(gen_ai.usage.input_tokens)": "1000",
        "sum(gen_ai.usage.output_tokens)": "100",
        "sum(gen_ai.usage.total_tokens)": "1100",
        "count()": "1",
      },
      {
        "user.id": "shreyas-95-cyber",
        "gen_ai.request.model": "gemini-pro-latest",
        "sum(gen_ai.usage.input_tokens)": "1000000",
        "sum(gen_ai.usage.output_tokens)": "0",
        "sum(gen_ai.usage.total_tokens)": "1000000",
        "count()": "1",
      },
    ];
    const costRows = [
      { "user.id": "shreyas-95-cyber", "gen_ai.request.model": "google/gemini-3.8-flash", "gen_ai.usage.cost.usd": "0.005" },
    ];
    const pricingTable = { "gemini-pro-latest": { input: 1, output: 0 } };
    const stats = athleteTokenStats(tokenRows, costRows, pricingTable);
    assert.equal(stats.length, 1);
    assert.equal(stats[0].athlete, "shreyas-95-cyber");
    assert.equal(stats[0].totalTokens, 1001100);
    // 0.005 (real) + 1 (estimated: 1_000_000 / 1e6 * 1) = 1.005
    assert.equal(stats[0].costUsd, 1.005);
    assert.equal(stats[0].estimated, true);
  });

  // Regression fixture: `prateekdevaraju` had error events (issues API) but never showed up in
  // the token/cost spans for the window; `skanda-testing` was the reverse — token spans but no
  // error events. `athleteTokenStats` only sees the token side of the join (the error side comes
  // from `athleteBreakdown`, folded in later by `athleteRows`), so from here the two athletes look
  // like plain absence-or-presence: one row when tokens exist, nothing when they don't.
  test("an athlete with token spans but no error events still gets a row", () => {
    const tokenRows = [
      {
        "user.id": "skanda-testing",
        "gen_ai.request.model": "gemini-pro-latest",
        "sum(gen_ai.usage.input_tokens)": "6000",
        "sum(gen_ai.usage.output_tokens)": "1321",
        "sum(gen_ai.usage.total_tokens)": "7321",
        "count()": "1",
      },
    ];
    const stats = athleteTokenStats(tokenRows, []);
    assert.deepEqual(stats, [
      { athlete: "skanda-testing", calls: 1, totalTokens: 7321, costUsd: null, estimated: false },
    ]);
  });

  test("an athlete absent from the token rows produces no row here at all", () => {
    // `prateekdevaraju` never appears in the gen_ai spans this window: no fixture row for them,
    // and athleteTokenStats has nothing to fold, so it returns no entry — the "—" the digest
    // renders for them comes from `athleteRows`' join, not from this function.
    const stats = athleteTokenStats([], []);
    assert.deepEqual(stats, []);
  });
});

describe("trendDirection", () => {
  test("null before or after yields null (can't compare)", () => {
    assert.equal(trendDirection(null, 5, 1), null);
    assert.equal(trendDirection(5, null, 1), null);
  });

  test("swing exactly at epsilon is NOT flat — the check is a strict less-than", () => {
    // diff = 10, epsilon = 10 -> Math.abs(diff) < epsilon is false, so this falls through to
    // climbing/falling rather than "flat". Confirm that boundary explicitly since it's an easy
    // off-by-one to introduce if the comparison is ever "tightened" to <=.
    assert.equal(trendDirection(10, 20, 10), "climbing");
  });

  test("swing just under epsilon reads as flat", () => {
    assert.equal(trendDirection(10, 19.999, 10), "flat");
  });

  test("swing just over epsilon reads as climbing or falling", () => {
    assert.equal(trendDirection(10, 20.001, 10), "climbing");
    assert.equal(trendDirection(20.001, 10, 10), "falling");
  });

  test("zero diff is always flat", () => {
    assert.equal(trendDirection(10, 10, 0.0001), "flat");
  });
});

describe("trendStats", () => {
  test("empty window on both halves: no calls, null success rates, still returns a shape", () => {
    const stats = trendStats({ hours: 24 }, [], []);
    assert.equal(stats.callsPerDayFirst, 0);
    assert.equal(stats.callsPerDaySecond, 0);
    assert.equal(stats.successRateFirst, null);
    assert.equal(stats.successRateSecond, null);
    // trendDirection(0, 0, epsilon) where epsilon = Math.max(1, 0 * 0.1) = 1 -> diff 0 -> flat.
    assert.equal(stats.callsDirection, "flat");
    assert.equal(stats.rateDirection, null);
  });

  test("second half climbing in both volume and success rate", () => {
    const window = { hours: 48 }; // halfDays = 1 each half
    const firstOps = [{ operation: "coach-chat", ok: 8, error: 2, calls: 10 }];
    const secondOps = [{ operation: "coach-chat", ok: 19, error: 1, calls: 20 }];
    const stats = trendStats(window, firstOps, secondOps);
    assert.equal(stats.callsPerDayFirst, 10);
    assert.equal(stats.callsPerDaySecond, 20);
    assert.equal(stats.callsDirection, "climbing");
    assert.equal(stats.successRateFirst, 80);
    assert.equal(stats.successRateSecond, 95);
    assert.equal(stats.rateDirection, "climbing");
  });

  test("first half has calls, second half is silent -> second half rate is null, not zero", () => {
    const window = { hours: 24 };
    const firstOps = [{ operation: "coach-chat", ok: 5, error: 0, calls: 5 }];
    const stats = trendStats(window, firstOps, []);
    assert.equal(stats.successRateFirst, 100);
    assert.equal(stats.successRateSecond, null);
    assert.equal(stats.rateDirection, null);
    assert.equal(stats.callsDirection, "falling");
  });
});

describe("resolveStale", () => {
  // `dryRun: true` never calls the Sentry PUT (see the source), so this exercises only the
  // filter logic — the "0 events in this window" selection — with no network access.
  test("empty issue list resolves nothing", async () => {
    const resolved = await resolveStale([], true);
    assert.deepEqual(resolved, []);
  });

  test("selects only issues with zero events in-window, using filtered.count when present", () => {
    return (async () => {
      const issues = [
        { id: "1", filtered: { count: 0 } },
        { id: "2", filtered: { count: 3 } },
        { id: "3", count: 0 }, // no `filtered` at all -> falls back to lifetime `count`
        { id: "4", count: 5 },
      ];
      const stale = await resolveStale(issues, true);
      assert.deepEqual(stale.map((i) => i.id), ["1", "3"]);
    })();
  });

  test("filtered.count of 0 wins over a nonzero lifetime count", () => {
    return (async () => {
      // A long-lived issue with a big lifetime count but nothing in this window is exactly the
      // "gone quiet" case resolveStale exists to auto-resolve.
      const issues = [{ id: "old-noisy-issue", count: 500, filtered: { count: 0 } }];
      const stale = await resolveStale(issues, true);
      assert.deepEqual(stale.map((i) => i.id), ["old-noisy-issue"]);
    })();
  });
});

describe("formatCost", () => {
  test("real (billed) cost has no marker", () => {
    assert.equal(formatCost(0.0094, false), "$0.0094");
  });

  test("estimated cost is prefixed with ~", () => {
    assert.equal(formatCost(2, true), "~$2.0000");
  });

  test("null cost reports no pricing data, regardless of the estimated flag", () => {
    assert.equal(formatCost(null, false), "no pricing data");
    assert.equal(formatCost(null, true), "no pricing data");
  });
});
