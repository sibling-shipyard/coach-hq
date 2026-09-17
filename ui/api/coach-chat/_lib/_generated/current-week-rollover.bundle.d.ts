// bundle-current-week-rollover-api.mjs (esbuild) supplies the runtime value in
// current-week-rollover.bundle.js; this file gives TypeScript the real types. A wildcard
// re-export, not a hand-picked list, so it can't drift out of sync with
// engine/lib/currentWeekRollover.mts's exported surface - that file is a different top-level
// band from ui/, edited by other roles with no signal back to this one, and
// currentWeekRollover.mts has no default export, so `export *` alone covers everything it has.
// Same pattern as current-week.bundle.d.ts.
export * from "../../../../../engine/lib/currentWeekRollover.mts";
