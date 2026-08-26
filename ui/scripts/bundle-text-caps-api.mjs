#!/usr/bin/env node
/**
 * Pre-build bundle for engine/lib/text-caps.mts.
 *
 * engine/ is a different top-level monorepo band from ui/. Vite spans the whole monorepo in
 * local dev so the raw cross-band import resolves fine there, but Vercel's build for api/*.ts
 * serverless functions is a separate system (it only traces ui/) and never picks up a raw
 * .mts import outside ui/ - that import is genuinely missing from the deployed Lambda (#553).
 * Same problem/fix shape as bundle-current-week-api.mjs, just a different cross-band source.
 */
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(uiRoot, "../engine/lib/text-caps.mts");
const outfile = path.join(uiRoot, "api/coach-chat/_lib/text-caps.bundle.js");

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  logLevel: "info",
});
