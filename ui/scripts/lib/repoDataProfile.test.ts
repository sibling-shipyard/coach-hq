import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRepoDataProfile } from "./repoDataProfile.js";

describe("repoDataProfile", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "repo-data-profile-test-"));
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  function writeJson(relativePath: string, content: unknown) {
    const fullPath = path.join(repoPath, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(content));
  }

  it("returns the empty/placeholder shape for a repo missing every input file", () => {
    const profile = buildRepoDataProfile(repoPath);
    expect(profile).toEqual({
      currentWeek: { dataStatus: "placeholder", sessionCount: 0 },
      injuries: { activeCount: 0, resolvedCount: 0 },
      quests: { count: 0, hasHabitQuest: false },
      coachingStyle: null,
      templateCount: 0,
    });
  });

  it("does not throw when only some input files exist", () => {
    writeJson("user_data/coach/injuries.json", { flags: [{ status: "active" }] });
    expect(() => buildRepoDataProfile(repoPath)).not.toThrow();
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.injuries).toEqual({ activeCount: 1, resolvedCount: 0 });
    expect(profile.currentWeek).toEqual({ dataStatus: "placeholder", sessionCount: 0 });
  });

  it("reads a placeholder week as 0 sessions", () => {
    writeJson("user_data/ledger/current_week.json", {
      schema_version: 1,
      data_status: "placeholder",
      days: [],
    });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.currentWeek).toEqual({ dataStatus: "placeholder", sessionCount: 0 });
  });

  it("reads a live week with real sessions across multiple days", () => {
    writeJson("user_data/ledger/current_week.json", {
      schema_version: 1,
      data_status: "live",
      days: [
        { date: "2026-09-14", sessions: [{ id: "sess_1" }, { id: "sess_2" }] },
        { date: "2026-09-15", sessions: [{ id: "sess_3" }] },
      ],
    });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.currentWeek).toEqual({ dataStatus: "live", sessionCount: 3 });
  });

  it("counts zero injury flags", () => {
    writeJson("user_data/coach/injuries.json", { flags: [] });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.injuries).toEqual({ activeCount: 0, resolvedCount: 0 });
  });

  it("counts one active injury flag", () => {
    writeJson("user_data/coach/injuries.json", {
      flags: [
        {
          id: "f1",
          text: "sore knee",
          status: "active",
          opened_at: "2026-09-01",
          resolved_at: null,
        },
      ],
    });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.injuries).toEqual({ activeCount: 1, resolvedCount: 0 });
  });

  it("counts many active and resolved injury flags", () => {
    writeJson("user_data/coach/injuries.json", {
      flags: [
        {
          id: "f1",
          text: "sore knee",
          status: "active",
          opened_at: "2026-09-01",
          resolved_at: null,
        },
        {
          id: "f2",
          text: "tight calf",
          status: "active",
          opened_at: "2026-09-05",
          resolved_at: null,
        },
        {
          id: "f3",
          text: "shoulder twinge",
          status: "resolved",
          opened_at: "2026-08-01",
          resolved_at: "2026-08-20",
        },
      ],
    });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.injuries).toEqual({ activeCount: 2, resolvedCount: 1 });
  });

  it("flags hasHabitQuest true when a real active habit quest exists", () => {
    writeJson("user_data/ledger/quests.json", {
      version: 1,
      _meta: { updated_at: "2026-09-01T00:00:00Z", updated_by: "model", trace_id: "t1" },
      weekly_targets: {},
      main_quest: null,
      quests: [
        {
          id: "q1",
          name: "Stretch daily",
          type: "daily_streak",
          start_date: "2026-09-01",
          end_date: null,
          status: "active",
          source: "model",
        },
      ],
    });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.quests).toEqual({ count: 1, hasHabitQuest: true });
  });

  it("flags hasHabitQuest false when quests[] only holds a retired former goal", () => {
    writeJson("user_data/ledger/quests.json", {
      version: 1,
      _meta: { updated_at: "2026-09-01T00:00:00Z", updated_by: "model", trace_id: "t1" },
      weekly_targets: {},
      main_quest: null,
      quests: [
        {
          id: "mq1",
          name: "Run a 10k",
          type: "count_target",
          start_date: "2026-06-01",
          end_date: "2026-09-01",
          status: "retired",
          target: 10,
          source: "model",
        },
      ],
    });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.quests).toEqual({ count: 1, hasHabitQuest: false });
  });

  it("reads the coaching style from memory.json", () => {
    writeJson("user_data/coach/memory.json", {
      version: 1,
      _meta: { updated_at: "2026-09-01T00:00:00Z", updated_by: "model", trace_id: "t1" },
      sports: ["run"],
      coaching_style: "accountability",
      notes: {},
    });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.coachingStyle).toBe("accountability");
  });

  it("counts real workout templates and ignores the manifest file", () => {
    writeJson("user_data/activities/workout_plans/templates/_manifest.json", {
      generated_at: "2026-09-01T00:00:00Z",
      trace_id: "t1",
      template_ids: ["tmpl_a", "tmpl_b"],
    });
    writeJson("user_data/activities/workout_plans/templates/tmpl_a.json", { id: "tmpl_a" });
    writeJson("user_data/activities/workout_plans/templates/tmpl_b.json", { id: "tmpl_b" });
    const profile = buildRepoDataProfile(repoPath);
    expect(profile.templateCount).toBe(2);
  });
});
