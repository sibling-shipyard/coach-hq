/**
 * P1 of the coach intent schema (docs/eng-docs/coach-intent-schema.md): appliers for the fields
 * the closing turn reports as facts, one pure function per field. "Pure" means: current file
 * content (and any other explicit inputs, like today's date) in, new file content out. No I/O,
 * no GitHub, no Gemini, no imports from coach-chat.ts - a teammate is separately editing
 * resolveFileUpdate() and the commit call there (coach-commit-mvp.md, Split 1), and this file
 * being self-contained means zero merge-conflict surface with that work.
 *
 * Deliberately NOT pure in the "no arguments but content" sense for two fields: applyQuestEvents
 * and applyCoachNote both take an explicit `today` string rather than reading the system clock
 * internally. That keeps them pure/testable (same input always produces the same output) while
 * still letting the caller supply "today" however it likes (server clock, athlete timezone, a
 * fixed value in a test).
 */

// ── session_note ─────────────────────────────────────────────────────────────

// Finds a `## <headingName>` section and splits it into the heading line and the body up to
// (not including) the next top-level `## ` heading or end of string. Mirrors the section-capture
// idiom already used in coachChatFiles.ts's isAthleteProfileComplete() for consistency.
function matchSection(
  content: string,
  headingName: string,
): { index: number; length: number; heading: string; body: string } | null {
  const re = new RegExp(`^(## ${headingName}[^\\n]*)\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`, "m");
  const m = re.exec(content);
  if (!m) return null;
  return { index: m.index, length: m[0].length, heading: m[1], body: m[2] };
}

function replaceSection(content: string, section: { index: number; length: number }, newHeading: string, newBody: string): string {
  const replacement = `${newHeading}\n${newBody}`;
  return content.slice(0, section.index) + replacement + content.slice(section.index + section.length);
}

// Each bullet is normally a single (long) line - e.g. "- **Day 139 (Mon Aug 3) - Badminton
// #51...**". Handled defensively anyway: a non-"- " line immediately after a bullet is treated as
// a continuation of that bullet rather than dropped, in case a future note wraps across lines.
function extractBulletEntries(body: string): string[] {
  const entries: string[] = [];
  for (const line of body.split("\n")) {
    if (/^-\s+/.test(line)) {
      entries.push(line.replace(/^-\s+/, ""));
    } else if (line.trim() !== "" && entries.length > 0) {
      entries[entries.length - 1] += "\n" + line;
    }
  }
  return entries;
}

// state.md's "Recent Session Notes" section (B_engine.md §12 step 2 / Pre-Commit Checklist):
// rolling window of the last 3 sessions, newest entry first, oldest dropped once there are more
// than 3. `note` is the full bullet text the model composed (no leading "- ", no date-prefix
// added by the server - the model is expected to write it, e.g. "Day 139 (Mon Aug 3) - ..." if it
// wants that framing; the server's job here is purely the rolling-window mechanic, not authoring).
// If the section can't be found (state.md missing this heading, e.g. a corrupted or pre-template
// file), the content is returned unchanged rather than guessing where to insert one - safer than
// silently fabricating a new section shape.
const RECENT_SESSION_NOTES_WINDOW = 3;

export function applySessionNote(content: string, note: string): string {
  const section = matchSection(content, "Recent Session Notes");
  if (!section) return content;
  const trimmedNote = note.trim();
  const entries = [trimmedNote, ...extractBulletEntries(section.body)].slice(0, RECENT_SESSION_NOTES_WINDOW);
  const newBody = entries.map((e) => `- ${e}`).join("\n") + "\n\n";
  return replaceSection(content, section, section.heading, newBody);
}

// ── quest_events ─────────────────────────────────────────────────────────────

export interface QuestEvent {
  quest_id: string;
  date: string; // YYYY-MM-DD
  status: string;
}

export interface QuestEventOutcome {
  event: QuestEvent;
  reason: string;
}

export interface QuestEventResult {
  content: string;
  applied: QuestEvent[];
  skipped: QuestEventOutcome[];
}

// challenge_v2.json's quest shapes, per engine/scripts/generate_quest_log.py (the canonical
// reader): daily_streak and weekly_frequency quests track dates in completed_dates /
// excused_dates / missed_dates (compute_daily_streak_stats, render_quest_log's weekly_frequency
// branch); progress quests track a numeric `current` against `target`. count_target quests
// (VALID_QUEST_TYPES) render as "-" everywhere in generate_quest_log.py today - there's no
// established manual-tracking field for them, automatic ones (main_quest) are driven entirely by
// matching synced activity names via count_pattern. Treating a count_target quest_event the same
// way as daily_streak (write into completed_dates) is a judgment call, not a read from the
// script - it's harmless (the field exists and is schema-valid even though nothing renders it
// yet) and consistent with "log an occurrence happened on this date." Flagged for review.
type QuestRecord = Record<string, unknown>;

function findQuest(doc: QuestRecord, questId: string): { quest: QuestRecord; type: string } | null {
  const mainQuest = doc.main_quest as QuestRecord | undefined;
  if (mainQuest && mainQuest.id === questId) {
    return { quest: mainQuest, type: String(mainQuest.type) };
  }
  const quests = (doc.quests as QuestRecord[] | undefined) ?? [];
  const match = quests.find((q) => q.id === questId);
  if (match) return { quest: match, type: String(match.type) };
  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// Applies quest_events to challenge_v2.json content and stamps last_updated_by/last_updated_at,
// per B_engine.md §12 step 4 / §8's existing instruction for this file. Always stamps on a call,
// even if every event was skipped - the server is asserting "coach touched this file at <today>,"
// which is true regardless of whether any individual event resolved cleanly.
//
// Unmatched quest ids, unrecognized statuses, and quest types outside P1 scope (only
// daily_streak, progress, count_target, weekly_frequency are handled - "milestone" is not) are
// skipped rather than thrown: one bad event in a close shouldn't sink the others, same philosophy
// as applyStringEdits' `failed` list in fileEdits.ts.
export function applyQuestEvents(content: string, events: QuestEvent[], today: string): QuestEventResult {
  let doc: QuestRecord;
  try {
    doc = JSON.parse(content) as QuestRecord;
  } catch (err) {
    const reason = `challenge_v2.json content is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return { content, applied: [], skipped: events.map((event) => ({ event, reason })) };
  }

  const applied: QuestEvent[] = [];
  const skipped: QuestEventOutcome[] = [];

  for (const event of events) {
    const found = findQuest(doc, event.quest_id);
    if (!found) {
      skipped.push({ event, reason: `quest_id "${event.quest_id}" not found in main_quest or quests[]` });
      continue;
    }
    const { quest, type } = found;

    if (type === "progress") {
      // "bump current" (design doc) has no explicit amount in the {quest_id, date, status}
      // shape, so a matching event bumps by 1. Only status "completed" bumps - a "missed" event
      // against a progress quest is recorded as a no-op rather than a decrement, since the shape
      // gives no signal that missed progress should claw back a prior gain.
      if (event.status !== "completed") {
        skipped.push({
          event,
          reason: `progress quests only bump "current" on status "completed" (got "${event.status}")`,
        });
        continue;
      }
      const current = typeof quest.current === "number" ? quest.current : 0;
      const target = typeof quest.target === "number" ? quest.target : undefined;
      quest.current = target !== undefined ? Math.min(current + 1, target) : current + 1;
      applied.push(event);
      continue;
    }

    if (type === "daily_streak" || type === "weekly_frequency" || type === "count_target") {
      const completed = new Set(asStringArray(quest.completed_dates));
      const excused = new Set(asStringArray(quest.excused_dates));
      const missed = new Set(asStringArray(quest.missed_dates));
      const hadExcused = "excused_dates" in quest;
      const hadMissed = "missed_dates" in quest;

      // A date belongs to exactly one array (mirrors compute_daily_streak_stats' comment: "Coach
      // writes to EITHER missed_dates OR excused_dates, never both for same date") - each branch
      // clears the date from the other two before adding it to its own.
      if (event.status === "completed") {
        completed.add(event.date);
        excused.delete(event.date);
        missed.delete(event.date);
      } else if (event.status === "excused") {
        excused.add(event.date);
        completed.delete(event.date);
        missed.delete(event.date);
      } else if (event.status === "missed") {
        missed.add(event.date);
        completed.delete(event.date);
        excused.delete(event.date);
      } else {
        skipped.push({ event, reason: `unknown status "${event.status}" for ${type} quest (expected completed/excused/missed)` });
        continue;
      }

      quest.completed_dates = Array.from(completed).sort();
      if (hadExcused || excused.size > 0) quest.excused_dates = Array.from(excused).sort();
      if (hadMissed || missed.size > 0) quest.missed_dates = Array.from(missed).sort();
      applied.push(event);
      continue;
    }

    skipped.push({
      event,
      reason: `quest type "${type}" isn't covered by quest_events (P1 scope: daily_streak, progress, count_target, weekly_frequency)`,
    });
  }

  doc.last_updated_by = "coach";
  doc.last_updated_at = today;

  return { content: JSON.stringify(doc, null, 2), applied, skipped };
}

// ── sleep (paired - see note below) ─────────────────────────────────────────

export interface SleepEntry {
  date: string; // YYYY-MM-DD
  hours: number;
}

// IMPORTANT - this applier is one half of a pair with applySleepLogJson below. Per the design
// doc: the coach never reads sleep_log.json at boot (B_engine.md §1 step 4 says state.md's Sleep
// Log table is what the coach itself sees), while sleep_log.json feeds the pipeline/UI instead
// (B_engine.md file-roles table) and is never read back by the coach. They are two views of the
// same fact and both must be written on every sleep report - the model has been half-doing this
// for exactly that reason (silent drift). The caller MUST invoke applySleepStateMd AND
// applySleepLogJson together for the same SleepEntry, in the same commit. Neither function
// enforces that pairing itself (each is a pure, single-file applier per the P1 file-isolation
// rule) - the pairing is a caller contract, not something this file can check.

const SLEEP_LOG_ROLLING_WINDOW = 7; // matches state.md's "## Sleep Log (rolling 7 days)" heading

function formatSleepDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

interface SleepTableRow {
  date: string;
  cells: string[]; // cells[0] is always the date
}

// Handles the two real row shapes seen across athlete repos: a standard markdown table row
// (`| 2026-07-28 | 8hrs | ... |`) and an ad hoc bullet-prefixed row with no wrapping pipes
// (`- 2026-04-06 | 7h19m | ... `). Header/separator lines fail the date check below and are
// skipped automatically.
function parseSleepRow(line: string): SleepTableRow | null {
  let s = line.trim();
  if (!s) return null;
  if (s.startsWith("-") && !s.startsWith("--")) s = s.slice(1).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells = s.split("|").map((c) => c.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) return null;
  return { date: cells[0], cells };
}

// Looks for an existing header row ("Date | Sleep | ..." with or without wrapping pipes) so the
// rewritten table keeps the same column count/labels this athlete's file already uses (5 columns
// with a Score column in one real repo, 4 without in another). Falls back to a minimal 3-column
// header (Date, Sleep, Notes) when no header is found at all.
function detectSleepHeaderCells(body: string): string[] | null {
  for (const line of body.split("\n")) {
    let s = line.trim();
    if (!s) continue;
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    const cells = s.split("|").map((c) => c.trim());
    if (cells[0]?.toLowerCase() === "date") return cells;
  }
  return null;
}

// Writes/updates one row in state.md's "## Sleep Log" table and enforces the rolling window the
// heading advertises. NORMALIZATION NOTE for reviewers: real athlete repos currently disagree on
// this table's exact shape - one repo uses a proper markdown table (header + `|---|` separator
// row), another uses a plain header line followed by "- date | ..." bullet rows with no
// separator at all. This function always emits a standard markdown pipe table on write
// (reusing the existing header's columns when found, see detectSleepHeaderCells), which
// normalizes the ad hoc format to the proper one going forward. Columns beyond Date/Sleep (e.g.
// Score, Resting HR, Notes) are filled with "-" for the new/updated row since the {date, hours}
// intent shape doesn't carry that data - only Date and Sleep are ever populated by this applier.
export function applySleepStateMd(content: string, entry: SleepEntry): string {
  const section = matchSection(content, "Sleep Log");
  if (!section) return content;

  const rows: SleepTableRow[] = [];
  for (const line of section.body.split("\n")) {
    const row = parseSleepRow(line);
    if (row) rows.push(row);
  }
  const headerCells = detectSleepHeaderCells(section.body) ?? ["Date", "Sleep", "Notes"];

  const newCells = headerCells.map((_, i) => (i === 0 ? entry.date : i === 1 ? formatSleepDuration(entry.hours) : "—"));
  const merged = rows.filter((r) => r.date !== entry.date);
  merged.push({ date: entry.date, cells: newCells });
  merged.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = merged.slice(-SLEEP_LOG_ROLLING_WINDOW);

  const headerLine = `| ${headerCells.join(" | ")} |`;
  const separatorLine = `|${headerCells.map(() => "------").join("|")}|`;
  const rowLines = trimmed.map((r) => `| ${headerCells.map((_, i) => r.cells[i] ?? "—").join(" | ")} |`);

  const newBody = [headerLine, separatorLine, ...rowLines].join("\n") + "\n\n";
  return replaceSection(content, section, section.heading, newBody);
}

// Writes/updates one entry in sleep_log.json (the pipeline/UI-facing full history - not a rolling
// window, unlike the state.md table). Upserts by date: an existing entry for the same date has
// only `hours` overwritten, preserving any resting_hr/notes a prior write already recorded; a new
// date gets a fresh record with resting_hr: null and notes: "" (matching the shape of real
// entries in coach-skanda-2003's sleep_log.json - this applier never has resting_hr/notes data of
// its own to contribute, since the {date, hours} intent shape doesn't carry them). Malformed or
// empty current content is treated as an empty log rather than thrown - defensive default, since
// a corrupt legacy file shouldn't block a real sleep report from landing somewhere.
export function applySleepLogJson(content: string, entry: SleepEntry): string {
  let arr: Array<Record<string, unknown>> = [];
  if (content && content.trim()) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  }
  const idx = arr.findIndex((r) => r.date === entry.date);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], hours: entry.hours };
  } else {
    arr.push({ date: entry.date, hours: entry.hours, resting_hr: null, notes: "" });
  }
  arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return JSON.stringify(arr, null, 2);
}

// ── coach_note ───────────────────────────────────────────────────────────────

// Defined here for completeness per the intent-schema design (all four fields live in one file),
// even though P0 (coach-commit-mvp.md, Skanda) owns wiring coach_note into the actual close path
// first and ships its own server-side append. If P0's shipped version differs from this one by
// the time both land, that's an integration-time reconciliation, not a P1 concern - the format
// below is exactly the P0 doc's Build section: `\n\n## <YYYY-MM-DD>\n<coach_note>` appended.
export function applyCoachNote(content: string, note: string, today: string): string {
  return content + `\n\n## ${today}\n${note.trim()}`;
}
