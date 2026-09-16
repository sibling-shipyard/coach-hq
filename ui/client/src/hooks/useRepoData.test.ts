import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/react", () => ({
  captureMessage,
}));

import {
  reportSchemaUnsupported,
  repoFileStatusIsFault,
  SUPPORTED_SCHEMA_VERSION,
} from "./useRepoData";

describe("repoFileStatusIsFault", () => {
  it("stays silent on the two statuses repo-file.ts answers without capturing", () => {
    // 401 is revoked access, 404 is a repo that has not synced yet. Both are normal states an
    // athlete passes through, and the API deliberately does not capture either.
    expect(repoFileStatusIsFault(401)).toBe(false);
    expect(repoFileStatusIsFault(404)).toBe(false);
  });

  it("reports the statuses that mean something broke", () => {
    for (const status of [400, 403, 500, 502, 503]) {
      expect(repoFileStatusIsFault(status)).toBe(true);
    }
  });
});

describe("reportSchemaUnsupported (#1108)", () => {
  beforeEach(() => {
    captureMessage.mockClear();
  });

  it("captures once with outcome schema_unsupported when schema_version is ahead", () => {
    const ahead = SUPPORTED_SCHEMA_VERSION + 1;
    expect(ahead).toBeGreaterThan(SUPPORTED_SCHEMA_VERSION);
    reportSchemaUnsupported(ahead);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      `repo-file schema_version unsupported: ${ahead}`,
      expect.objectContaining({
        level: "error",
        tags: expect.objectContaining({
          outcome: "schema_unsupported",
          schema_version: String(ahead),
          supported_schema_version: String(SUPPORTED_SCHEMA_VERSION),
          fetch_endpoint: "/api/repo-file",
        }),
      }),
    );
  });
});
