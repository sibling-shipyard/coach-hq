import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "node:path";
import { defineConfig } from "vite";

const sentryRelease =
  process.env.VITE_SENTRY_RELEASE ??
  process.env.SENTRY_RELEASE ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  "development";
const sentryEnvironment =
  process.env.VITE_SENTRY_ENVIRONMENT ??
  process.env.SENTRY_ENVIRONMENT ??
  process.env.VERCEL_ENV ??
  process.env.NODE_ENV ??
  "development";

// Source maps are generated and uploaded only when SENTRY_AUTH_TOKEN is set, so local
// and fork builds stay unchanged. Without them a production stack frame is minified
// noise, which is the whole point of the release tags below.
const sentryUpload =
  process.env.SENTRY_AUTH_TOKEN &&
  process.env.SENTRY_ORG &&
  process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: sentryRelease },
        // The maps reach Sentry, then leave the deployed bundle: they are debug
        // artifacts, not something to serve to every visitor.
        sourcemaps: { filesToDeleteAfterUpload: ["**/*.map"] },
      })
    : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(sentryUpload ? [sentryUpload] : [])],
  define: {
    "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(sentryRelease),
    "import.meta.env.VITE_SENTRY_ENVIRONMENT":
      JSON.stringify(sentryEnvironment),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@golden": path.resolve(
        import.meta.dirname,
        "..",
        "shared",
        "golden-dataset",
      ),
      "@warm-instrument": path.resolve(
        import.meta.dirname,
        "..",
        "shared",
        "warm-instrument",
      ),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  // vercel env pull / manual local secrets land in ui/.env.local, not ui/client/ (root above) -
  // without this, Vite looks for env files next to `root` and never sees VITE_FORCE_HOSTED_AUTH.
  envDir: import.meta.dirname,
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    sourcemap: Boolean(sentryUpload),
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
