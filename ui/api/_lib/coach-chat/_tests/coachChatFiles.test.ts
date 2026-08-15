import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isAthleteProfileComplete, loadCoachContext } from "../coachChatFiles.js";

// B2: matches carve-skeleton.mjs's STATE_MD_TEMPLATE exactly - the blank template every new
// athlete repo ships with.
const BLANK_TEMPLATE = `## Athlete Profile
*(Filled in during First Session)*
- **Name:**
- **Sport(s) / Activities:**
- **Goal:**
- **Timeline / Upcoming events:**
- **Coaching style preference:**
- **Timezone:**

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
    // 2 files (state.md, quest_log.md) fetched once, not once per caller - SOUL.md no longer
    // comes from the athlete's repo at all (bundled from platform/SOUL.md, see build-soul.mjs).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a fresh:true call never shares the in-flight de-dup, even if one is already pending", async () => {
    const repo = `owner/repo-fresh-${Date.now()}`;
    const [cached, fresh] = await Promise.all([
      loadCoachContext(repo, "token"),
      loadCoachContext(repo, "token", { fresh: true }),
    ]);
    expect(cached).toEqual(fresh);
    // Each call does its own independent 2-file fetch since one of them demanded freshness.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
