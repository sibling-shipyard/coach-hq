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
      "@warm-instrument": path.resolve(import.meta.dirname, "..", "shared", "warm-instrument"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  // vercel env pull / manual local secrets land in ui/.env.local, not ui/client/ (root above) -
  // without this, Vite looks for env files next to `root` and never sees VITE_FORCE_HOSTED_AUTH.
  envDir: import.meta.dirname,
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
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: false,
        // Vite's proxy rewrites the Host header to the target by default even with
        // changeOrigin: false - the auth handlers build the OAuth redirect_uri from the
        // request's Host, so without this it comes out as localhost:3001 instead of 3000.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.headers.host) proxyReq.setHeader("host", req.headers.host);
          });
        },
      },
    },
  },
  preview: {
    allowedHosts: true,
  },
});
