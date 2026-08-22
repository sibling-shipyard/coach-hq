#!/usr/bin/env node
/**
 * Pre-build bundle for /api/widget-snapshots.
 *
 * Vercel serverless functions don't resolve tsconfig `@/*` path aliases at runtime.
 * The snapshot generator pulls in home-warm models from client/src, so we esbuild
 * it into a single ESM file with aliases rewritten before deploy.
 */
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(uiRoot, "api/auth/_lib/generate-widget-snapshots-from-dashboard-snapshot.ts");
const outfile = path.join(
  uiRoot,
  "api/auth/_lib/generate-widget-snapshots-from-dashboard-snapshot.bundle.js",
);

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  alias: {
    "@": path.join(uiRoot, "client/src"),
    "@warm-instrument": path.join(uiRoot, "..", "shared", "warm-instrument"),
  },
  logLevel: "info",
});
