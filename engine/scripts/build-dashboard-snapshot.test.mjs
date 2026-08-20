import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadLedger } from "./build-dashboard-snapshot.mjs";

function repoWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-snapshot-"));
  fs.mkdirSync(path.join(root, "user_data/ledger"), { recursive: true });
  for (const [name, value] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, "user_data/ledger", name), JSON.stringify(value));
  }
  return root;
}

test("complete split ledger wins without legacy hybrid", (t) => {
  const files = {
    "seasons.json": { version: 1, seasons: [{ id: "s1" }] },
    "quests.json": { version: 1, main_quest: { id: "main" } },
    "progress.json": { version: 1, rows: [] },
    "progressions.json": { version: 1, progressions: [] },
    "challenge_v2.json": { version: 4, stale: true },
  };
  const root = repoWith(files);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(loadLedger(root), {
    ledger_schema: "split_v1",
    ledger: { seasons: files["seasons.json"], quests: files["quests.json"], progress: files["progress.json"], progressions: files["progressions.json"] },
    challenge_v2: null,
  });
});

test("partial split ledger falls back to whole unmigrated challenge", (t) => {
  const legacy = { version: 4, main_quest: { id: "main" }, quests: [] };
  const root = repoWith({ "seasons.json": { version: 1 }, "challenge_v2.json": legacy });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(loadLedger(root), { ledger_schema: "challenge_v2_v4", ledger: null, challenge_v2: legacy });
});
