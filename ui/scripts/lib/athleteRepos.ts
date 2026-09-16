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
