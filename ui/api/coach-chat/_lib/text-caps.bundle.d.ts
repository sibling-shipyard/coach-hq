// bundle-text-caps-api.mjs (esbuild) supplies the runtime value in text-caps.bundle.js; this
// file gives TypeScript the real types. A wildcard re-export, not a hand-picked list, so it
// can't drift out of sync with engine/lib/text-caps.mts's exported surface - that file is a
// different top-level band from ui/, edited by other roles with no signal back to this one, and
// text-caps.mts has no default export, so `export *` alone covers everything it has.
export * from "../../../../engine/lib/text-caps.mts";
