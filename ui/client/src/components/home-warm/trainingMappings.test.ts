import { describe, expect, it } from "vitest";
import {
  normaliseRuntimeDiscipline,
  sessionDisciplineToSnapshotSport,
  trainingCategoryToSessionDiscipline,
  trainingCategoryToWarmSport,
} from "./trainingMappings";

describe("training mappings", () => {
  it("folds recovery categories into the foundation display sport", () => {
    expect(trainingCategoryToWarmSport("recovery")).toBe("foundation");
    expect(trainingCategoryToWarmSport("realign")).toBe("foundation");
  });

  it("preserves recovery in session discipline contracts", () => {
    expect(trainingCategoryToSessionDiscipline("recovery")).toBe("recovery");
    expect(sessionDisciplineToSnapshotSport("recovery")).toBe("recovery");
  });

  it("normalises free runtime strings without changing the typed mappings", () => {
    expect(normaliseRuntimeDiscipline("Badminton: Ranked")).toBe("badminton");
    expect(normaliseRuntimeDiscipline("Mobility")).toBe("recovery");
    expect(normaliseRuntimeDiscipline("Soccer")).toBe("football");
    expect(normaliseRuntimeDiscipline("Unmapped session")).toBe("other");
  });
});
