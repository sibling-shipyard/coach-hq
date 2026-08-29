/**
 * The two tags a browser event can never fix at runtime. Every case here was a real
 * `coach-hq-web` event: 581 spans, all of them `environment: production`, `release: development`,
 * including the ones from preview deploys (#641).
 */
import { describe, expect, it } from "vitest";
import { resolveSentryBuildTags } from "./sentryBuildTags";

describe("resolveSentryBuildTags", () => {
  it("calls a preview deploy a preview, which Vite's mode alone never can", () => {
    const tags = resolveSentryBuildTags(
      { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: "abc123" },
      "production",
    );

    expect(tags.environment).toBe("preview");
  });

  it("reports the deploy's commit as the release, so source maps have something to match", () => {
    const tags = resolveSentryBuildTags(
      { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "abc123" },
      "production",
    );

    expect(tags).toEqual({ environment: "production", release: "abc123" });
  });

  it("lets an explicit VITE_SENTRY_* override beat the Vercel value", () => {
    const tags = resolveSentryBuildTags(
      {
        VITE_SENTRY_ENVIRONMENT: "staging",
        VITE_SENTRY_RELEASE: "v1.2.3",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_SHA: "abc123",
      },
      "production",
    );

    expect(tags).toEqual({ environment: "staging", release: "v1.2.3" });
  });

  it("falls back to the build mode off Vercel, where a local run really is development", () => {
    const tags = resolveSentryBuildTags({}, "development");

    expect(tags).toEqual({ environment: "development", release: "development" });
  });

  it("treats an empty var as unset rather than tagging events with an empty string", () => {
    const tags = resolveSentryBuildTags(
      { VITE_SENTRY_ENVIRONMENT: "", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: "" },
      "production",
    );

    expect(tags).toEqual({ environment: "preview", release: "development" });
  });
});
