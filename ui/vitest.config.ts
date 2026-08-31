import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Separate from vite.config.ts: that one sets root to client/ for the app build, but tests
// live under both client/ and api/, so this keeps the repo root as vitest's root instead.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@golden": path.resolve(import.meta.dirname, "..", "shared", "golden-dataset"),
      "@warm-instrument": path.resolve(import.meta.dirname, "..", "shared", "warm-instrument"),
    },
  },
  test: {
    include: [
      "client/src/**/*.{test,spec}.{ts,tsx}",
      "api/**/_tests/**/*.{test,spec}.{ts,tsx}",
      "observability/**/*.{test,spec}.{ts,tsx}",
      "../engine/lib/**/*.test.mts",
    ],
  },
});
