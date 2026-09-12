import { describe, expect, it } from "vitest";
import { formatMinutesInstrumentLabel } from "./formatUtils";

describe("formatMinutesInstrumentLabel", () => {
  it("formats minute values as compact instrument text", () => {
    expect(formatMinutesInstrumentLabel(90)).toBe("1H30");
    expect(formatMinutesInstrumentLabel(45)).toBe("45 MIN");
  });
});
