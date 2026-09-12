#!/usr/bin/env node
/**
 * Pre-build bundle for engine/lib/compileWorkout.mts.
 *
 * Same problem/fix shape as bundle-current-week-api.mjs: engine/ is a different top-level
 * monorepo band from ui/, and Vercel's build for api/*.ts serverless functions only traces ui/,
 * so a raw cross-band .mts import is genuinely missing from the deployed Lambda. workout_create
 * (A2) needs the compiler server-side to turn a Coach-authored spec into timer-ready JSON, so it
 * gets the same small bundled shim rather than a raw cross-folder import.
 */
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(uiRoot, "../engine/lib/compileWorkout.mts");
const outfile = path.join(uiRoot, "api/coach-chat/_lib/compile-workout.bundle.js");

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
