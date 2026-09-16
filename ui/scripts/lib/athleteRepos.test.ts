import { describe, expect, it } from "vitest";
import { ATHLETE_REPOS, resolveAthleteOverride } from "./athleteRepos.js";

// #1105 A3: resolveAthleteOverride is what run-simulation-suite.ts's --repo and --all-repos flags
// both use to turn a shortcut into the athlete/repo/localPath triple they force onto every
// scenario for a run - this checks that lookup and its failure mode directly, without going
// anywhere near the CLI or the child-process flow.
describe("resolveAthleteOverride", () => {
  it("resolves a known shortcut to its real repo and local clone path", () => {
    expect(resolveAthleteOverride("akash")).toEqual({
      athlete: "akash",
      repo: ATHLETE_REPOS.akash.repo,
      localPath: ATHLETE_REPOS.akash.localPath,
    });
  });

  it("throws a clear error naming the valid shortcuts when given an unknown one", () => {
    expect(() => resolveAthleteOverride("nonexistent")).toThrow(
      /Unknown --repo shortcut "nonexistent".*skanda.*akash/s,
    );
  });
});
