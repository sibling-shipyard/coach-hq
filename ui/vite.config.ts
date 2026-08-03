import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@golden": path.resolve(import.meta.dirname, "..", "shared", "golden-dataset"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
    fs: {
      allow: [path.resolve(import.meta.dirname, "..")],
    },
    // Only hit when VITE_FORCE_HOSTED_AUTH=true routes real fetches through - see
    // ui/scripts/local-api-server.mjs and #61/#63. Harmless when that server isn't running,
    // since nothing calls /api/* locally unless the flag is set.
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  preview: {
    allowedHosts: true,
  },
});
