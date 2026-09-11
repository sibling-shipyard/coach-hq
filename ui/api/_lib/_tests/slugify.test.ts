import { describe, expect, it } from "vitest";
import { slugify } from "../slugify.js";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumeric runs to the separator", () => {
    expect(slugify("Left Hip Pain!!", "_")).toBe("left_hip_pain");
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  --already dashed--  ", "-")).toBe("already-dashed");
  });

  it("caps length when maxLength is given", () => {
    expect(slugify("a very long injury description text", "_", 10)).toBe("a_very_lon");
  });

  it("leaves length uncapped when maxLength is omitted", () => {
    expect(slugify("skanda-2003/coach-skanda-2003", "-")).toBe("skanda-2003-coach-skanda-2003");
  });

  it("returns an empty string for input with no alphanumeric characters", () => {
    expect(slugify("!!!", "_")).toBe("");
  });
});
