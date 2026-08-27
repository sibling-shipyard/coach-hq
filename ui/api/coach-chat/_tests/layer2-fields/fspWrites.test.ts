import { describe, expect, it } from "vitest";
import type { FileEntry } from "../../../_lib/githubGitData.js";
import { fspIncrementalWrites, ordinaryTurnResponse } from "../../_lib/fspWrites.js";

describe("fspIncrementalWrites", () => {
  const profile: FileEntry = { path: "user_data/coach/profile.json", content: "{}" };
  const season: FileEntry = { path: "user_data/ledger/seasons.json", content: "{}" };

  it("keeps present FSP action writes for an incomplete athlete", () => {
    expect(fspIncrementalWrites(false, [profile, undefined, season])).toEqual([profile, season]);
  });

  it("does not write ordinary turns after First Session is complete", () => {
    expect(fspIncrementalWrites(true, [profile, season])).toEqual([]);
  });

  it("does not create an empty commit when Gemini reports no FSP actions", () => {
    expect(fspIncrementalWrites(false, [undefined, undefined])).toEqual([]);
  });
});

describe("ordinaryTurnResponse", () => {
  it("returns the freshly projected profile completeness on an ordinary turn", () => {
    expect(ordinaryTurnResponse("Next question.", "abc123", false, true)).toEqual({
      reply: "Next question.",
      closed: false,
      repoSha: "abc123",
      stale: false,
      profileComplete: true,
    });
  });
});
