// bundle-current-week-api.mjs (esbuild) supplies the runtime value in current-week.bundle.js;
// this file gives TypeScript the real types. A wildcard re-export, not a hand-picked list, so
// it can't drift out of sync with engine/lib/current-week.mts's exported surface - that file is
// a different top-level band from ui/, edited by other roles with no signal back to this one,
// and current-week.mts has no default export, so `export *` alone covers everything it has.
export * from "../../../../engine/lib/current-week.mts";
