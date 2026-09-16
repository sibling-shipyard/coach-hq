// athleteRepos.ts - the map of known --athlete shortcuts to their real repo + local clone path.
// run-manual-coach-chat-test.ts uses this for its --athlete flag; run-simulation-suite.ts uses it
// too, to find a scenario's local clone path so it can check preconditions (#1105) before ever
// invoking run-manual-coach-chat-test.ts as a child process. Pulled out here so there's one copy
// instead of two maps quietly drifting apart.
export const ATHLETE_REPOS: Record<string, { repo: string; localPath: string }> = {
  skanda: {
    repo: "skanda-2003/coach-skanda-2003",
    localPath: "/home/skanda_suresh/Projects/coach-skanda",
  },
  akash: {
    repo: "akash-suresh/coach-akash-suresh",
    localPath: "/home/skanda_suresh/Projects/coach-akash",
  },
  date2022: {
    repo: "date2022/coach-date2022",
    localPath: "/home/skanda_suresh/Projects/coach-date2022",
  },
  prateek: {
    repo: "prateekdevaraju/coach-prateekdevaraju",
    localPath: "/home/skanda_suresh/Projects/coach-prateek",
  },
  shreyas: {
    repo: "shreyas-95-cyber/coach-shreyas-95-cyber",
    localPath: "/home/skanda_suresh/Projects/coach-shreyas",
  },
};

// #1105 A3: --repo and --all-repos both need to force a scenario's athlete/repo/localPath to a
// specific real repo regardless of what the scenario itself hardcodes. This is the one place that
// turns a shortcut into the override triple, so run-simulation-suite.ts's two flags share the same
// resolution (and the same error) instead of each rolling their own lookup.
export interface AthleteOverride {
  athlete: string;
  repo: string;
  localPath: string;
}

export function resolveAthleteOverride(shortcut: string): AthleteOverride {
  const entry = ATHLETE_REPOS[shortcut];
  if (!entry) {
    throw new Error(
      `Unknown --repo shortcut "${shortcut}" - expected one of: ${Object.keys(ATHLETE_REPOS).join(", ")}`,
    );
  }
  return { athlete: shortcut, repo: entry.repo, localPath: entry.localPath };
}
