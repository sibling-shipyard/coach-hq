import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isAthleteProfileComplete, loadCoachContext } from "../_lib/coachChatFiles.js";

// B2: matches carve-skeleton.mjs's STATE_MD_TEMPLATE exactly - the blank template every new
// athlete repo ships with. It had drifted (no Age/Height/Weight, and Timezone's italic note
// missing) which is part of why #362 went unnoticed: the fixture was easier to satisfy than the
// real template. Keep these in sync.
const BLANK_TEMPLATE = `## Athlete Profile
*(Filled in during First Session)*
- **Name:**
- **Sport(s) / Activities:**
- **Goal:**
- **Timeline / Upcoming events:**
- **Coaching style preference:**
- **Age:**
- **Height:**
- **Weight:**
- **Timezone:**
  *(inferred from the athlete's stated city/country, not asked directly — see FSP §10)*

## Current Season
*(Defined during First Session)*
`;

const FILLED_TEMPLATE = `## Athlete Profile
*(Filled in during First Session)*
- **Name:** Skanda
- **Sport(s) / Activities:** Badminton, running
- **Goal:** Get back to competitive shape
- **Timeline / Upcoming events:** Club tournament in October
- **Coaching style preference:** Direct, no hand-holding
- **Age:** 29
- **Height:** 178cm
- **Weight:** 74kg
- **Timezone:** Asia/Kolkata (IST, UTC+5:30)

## Current Season
*(Defined during First Session)*
`;

describe("isAthleteProfileComplete", () => {
  it("is false for the blank template every new athlete repo ships with", () => {
    expect(isAthleteProfileComplete(BLANK_TEMPLATE)).toBe(false);
  });

  it("is true once every field line has content", () => {
    expect(isAthleteProfileComplete(FILLED_TEMPLATE)).toBe(true);
  });

  // #362: the whole point of the fix. Age/Height/Weight are context the athlete may decline;
  // requiring them meant one skipped answer re-injected the First Session Protocol on every
  // turn, forever, re-onboarding someone who was already onboarded.
  it("is true when the athlete declined the optional fields", () => {
    const declined = `## Athlete Profile
- **Name:** Skanda
- **Sport(s) / Activities:** Badminton
- **Goal:** Get back to competitive shape
- **Timeline / Upcoming events:**
- **Coaching style preference:**
- **Age:**
- **Height:**
- **Weight:**
- **Timezone:**

## Current Season
`;
    expect(isAthleteProfileComplete(declined)).toBe(true);
  });

  it("is false when a required field is missing even if every optional one is filled", () => {
    const noGoal = `## Athlete Profile
- **Name:** Skanda
- **Sport(s) / Activities:** Badminton
- **Goal:**
- **Age:** 29
- **Height:** 178cm
- **Weight:** 74kg
- **Timezone:** Asia/Kolkata

## Current Season
`;
    expect(isAthleteProfileComplete(noGoal)).toBe(false);
  });

  // The Timezone line ships with an italic explainer. It used to sit after the colon, which made
  // a blank field read as filled; it is now on its own line and must not count as a field.
  it("does not treat the Timezone explainer note as an answer", () => {
    const noteOnly = `## Athlete Profile
- **Name:**
- **Sport(s) / Activities:**
- **Goal:**
- **Timezone:**
  *(inferred from the athlete's stated city/country, not asked directly — see FSP §10)*

## Current Season
`;
    expect(isAthleteProfileComplete(noteOnly)).toBe(false);
  });

  // A renamed/reshaped profile must never block forever - that is the #362 failure mode itself.
  it("falls back to 'answered anything' when no required label is recognisable", () => {
    const renamed = `## Athlete Profile
- **Who they are:** Skanda
- **What they do:** Badminton

## Current Season
`;
    expect(isAthleteProfileComplete(renamed)).toBe(true);
    expect(isAthleteProfileComplete("## Athlete Profile\n- **Who they are:**\n")).toBe(false);
  });

  it("is false when some fields are filled but others are still blank (mid-intake)", () => {
    const partial = `## Athlete Profile
*(Filled in during First Session)*
- **Name:** Skanda
- **Sport(s) / Activities:** Badminton
- **Goal:**
- **Timeline / Upcoming events:**
- **Coaching style preference:**
- **Timezone:**

## Current Season
`;
    expect(isAthleteProfileComplete(partial)).toBe(false);
  });

  it("is false when the Athlete Profile section is missing entirely", () => {
    expect(isAthleteProfileComplete("## Current Season\nsome content\n")).toBe(false);
  });

  it("is false for an empty string", () => {
    expect(isAthleteProfileComplete("")).toBe(false);
  });

  it("still works when Athlete Profile is the last section in the file (no trailing ##)", () => {
    const lastSection = `## Current Season
whatever

## Athlete Profile
- **Name:** Skanda
- **Sport(s) / Activities:** Running
- **Goal:** Sub-20 5k
- **Timeline / Upcoming events:** none
- **Coaching style preference:** direct
- **Timezone:** UTC
`;
    expect(isAthleteProfileComplete(lastSection)).toBe(true);
  });

  it("treats whitespace-only content after the colon as still blank", () => {
    const whitespaceOnly = `## Athlete Profile
- **Name:**
- **Sport(s) / Activities:** Running
- **Goal:** Sub-20 5k
- **Timeline / Upcoming events:** none
- **Coaching style preference:** direct
- **Timezone:** UTC

## Current Season
`;
    expect(isAthleteProfileComplete(whitespaceOnly)).toBe(false);
  });
});

// Audit fix: concurrent cache-miss callers for the same repo used to each independently hit
// GitHub for the same three files - now they share one in-flight fetch.
describe("loadCoachContext in-flight de-dup", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response("content", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one round-trip across concurrent cache-miss calls for the same repo", async () => {
    const repo = `owner/repo-concurrent-${Date.now()}`; // unique per test - module cache persists across tests
    const [a, b] = await Promise.all([
      loadCoachContext(repo, "token"),
      loadCoachContext(repo, "token"),
    ]);
    expect(a).toEqual(b);
    // 3 files (state.md, quest_log.md, rolling_state.json) fetched once, not once per caller -
    // SOUL.md no longer comes from the athlete's repo at all (bundled from platform/SOUL.md, see
    // build-soul.mjs).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a fresh:true call never shares the in-flight de-dup, even if one is already pending", async () => {
    const repo = `owner/repo-fresh-${Date.now()}`;
    const [cached, fresh] = await Promise.all([
      loadCoachContext(repo, "token"),
      loadCoachContext(repo, "token", { fresh: true }),
    ]);
    expect(cached).toEqual(fresh);
    // Each call does its own independent 3-file fetch since one of them demanded freshness.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
