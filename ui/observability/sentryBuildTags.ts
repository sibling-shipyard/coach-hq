/**
 * sentryBuildTags.ts — which `environment` and `release` the browser bundle reports.
 *
 * The browser has no runtime env: whatever Vite bakes in at build time is what every event
 * carries forever. Vite's own `MODE` is `production` for every built bundle, preview included,
 * so it cannot tell a preview deploy from production. Vercel's build-time `VERCEL_ENV` and
 * `VERCEL_GIT_COMMIT_SHA` can, and `ui/vite.config.ts` feeds them through here.
 *
 * Release matters as much as environment: Sentry matches uploaded source maps to a release, so a
 * bundle that reports a placeholder can never be un-minified.
 */
export interface SentryBuildEnv {
  /** Explicit override, from a `.env` file or the Vercel dashboard. Wins when set. */
  VITE_SENTRY_ENVIRONMENT?: string;
  /** Explicit override, same as above. */
  VITE_SENTRY_RELEASE?: string;
  /** Vercel build-time system var: `production` | `preview` | `development`. */
  VERCEL_ENV?: string;
  /** Vercel build-time system var: the full commit SHA of the deploy. */
  VERCEL_GIT_COMMIT_SHA?: string;
}

export interface SentryBuildTags {
  environment: string;
  release: string;
}

/**
 * `mode` is Vite's build mode, the last resort when nothing else names the environment — it is
 * right for a local `npm run dev` and wrong on any Vercel deploy, hence the two lookups first.
 */
export function resolveSentryBuildTags(env: SentryBuildEnv, mode: string): SentryBuildTags {
  return {
    environment: env.VITE_SENTRY_ENVIRONMENT || env.VERCEL_ENV || mode,
    release: env.VITE_SENTRY_RELEASE || env.VERCEL_GIT_COMMIT_SHA || "development",
  };
}
