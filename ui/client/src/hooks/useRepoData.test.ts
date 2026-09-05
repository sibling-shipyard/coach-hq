import { describe, expect, it } from "vitest";
import { repoFileStatusIsFault } from "./useRepoData";

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
