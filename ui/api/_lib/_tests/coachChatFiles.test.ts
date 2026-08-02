import { describe, it, expect } from "vitest";
import { isAthleteProfileComplete } from "../coachChatFiles.js";

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
