import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoData = path.join(root, "shared/golden-dataset/repo-data");

test("golden dashboard carries an exact history-file match for every badminton activity", () => {
  execFileSync(process.execPath, [path.join(repoData, "../generate-repo-data.mjs")], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync(process.execPath, [path.join(root, "ui/scripts/build-data.mjs")], {
    cwd: root,
    stdio: "ignore",
  });

  const activities = JSON.parse(fs.readFileSync(path.join(repoData, "activities.json"), "utf8"));
  const history = JSON.parse(fs.readFileSync(path.join(repoData, "match_history.json"), "utf8"));
  const dashboard = JSON.parse(
    fs.readFileSync(path.join(root, "ui/client/src/data/dashboard_snapshot.json"), "utf8"),
  );
  const matchActivities = activities.filter((activity) => activity.history_file);
  const sessionsByFile = new Map(history.sessions.map((session) => [session.historyFile, session]));

  assert.ok(matchActivities.length > 0);
  assert.equal(history.sessions.length, matchActivities.length);
  assert.deepEqual(dashboard.match_history, history);
  for (const activity of matchActivities) {
    const session = sessionsByFile.get(activity.history_file);
    assert.ok(session, `missing match session for ${activity.history_file}`);
    assert.equal(session.date, activity.start_date_local.slice(0, 10));
    assert.equal(session.activityId, activity.id);
    assert.ok(session.games.length > 0);
  }
});
