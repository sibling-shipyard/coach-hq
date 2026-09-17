/**
 * Fresh re-read of today's activity notes for an ordinary reply turn (#1147).
 *
 * The proactive coach message (coach-message/_lib/coachMessage.ts) reads an activity's
 * description right after sync, but generation fires before the athlete has usually written
 * anything. When they reply later in that same seeded thread, the ordinary chat-turn pipeline
 * never re-reads user_data/activities/hist/*.json - so a note added mid-conversation never
 * reached the coach. This scans the client-echoed synced_activity_list attachment(s) already
 * sitting in priorMessages, keeps only today's activities, and re-reads each one's current
 * description fresh, every turn - no caching across turns, which is what lets a note written
 * several replies into the conversation show up starting the very next reply.
 */
import {
  activityMatches,
  candidateFile,
  isObject,
  requestedIdParts,
  type ActivityFileEntry,
} from "../../../_lib/activityLookup.js";
import type {
  ChatMessage,
  SyncedActivityListAttachment,
  SyncedActivityRow,
} from "../chatThreads.js";

export interface TodayActivityNote {
  activity_id: string;
  title: string;
  note: string;
}

// ADR 0032 / #1078: both deps are a best-effort read that must fail open, never throw - the
// caller (turnRequest.ts's loadTurnState) is expected to capture any real fault to Sentry inside
// these functions and resolve to [] / null so this module never needs its own try/catch, and a
// GitHub or parse fault here degrades to "no note" instead of breaking the whole reply turn.
export interface TodayActivityNoteDeps {
  listActivityFiles: () => Promise<ActivityFileEntry[]>;
  readFile: (path: string) => Promise<string | null>;
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

// synced_activity_list rows carry only a bare uuid (activitySync.ts's attachmentRowFromJson) -
// the activity_sync request that seeds this attachment only ever accepts hk:<uuid> ids
// (parseActivityIds), so "healthkit" is the only source that can ever reach this shape.
function qualifiedActivityId(row: SyncedActivityRow): string {
  return `healthkit:${row.id}`;
}

// start_date_local is already the athlete's local wall-clock time (not UTC - see how the
// dashboard-snapshot generator keys off the same field with a plain .slice(0, 10)), so comparing
// its date prefix directly against today's date string is correct without any further timezone
// conversion.
function todaysSyncedRows(priorMessages: ChatMessage[], today: string): SyncedActivityRow[] {
  const seen = new Set<string>();
  const rows: SyncedActivityRow[] = [];
  for (const message of priorMessages) {
    if (message.role !== "coach" || !message.attachments) continue;
    for (const attachment of message.attachments) {
      if (attachment.kind !== "synced_activity_list") continue;
      const listAttachment = attachment as SyncedActivityListAttachment;
      for (const row of listAttachment.activities) {
        if (row.start.slice(0, 10) !== today) continue;
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    }
  }
  return rows;
}

async function readNote(
  row: SyncedActivityRow,
  entries: ActivityFileEntry[],
  readFile: TodayActivityNoteDeps["readFile"],
): Promise<TodayActivityNote | null> {
  const activityId = qualifiedActivityId(row);
  const { source, localId } = requestedIdParts(activityId);
  const candidates = entries.filter((entry) => candidateFile(entry, localId));
  for (const entry of candidates) {
    const value = parseJson(await readFile(entry.path));
    if (!activityMatches(value, source, localId)) continue;
    const note =
      isObject(value) && typeof value.description === "string" ? value.description.trim() : "";
    if (!note) return null;
    return { activity_id: activityId, title: row.title, note };
  }
  return null;
}

export async function loadTodayActivityNotes(
  priorMessages: ChatMessage[],
  today: string,
  deps: TodayActivityNoteDeps,
): Promise<TodayActivityNote[]> {
  const rows = todaysSyncedRows(priorMessages, today);
  if (rows.length === 0) return [];
  const entries = await deps.listActivityFiles();
  const notes = await Promise.all(rows.map((row) => readNote(row, entries, deps.readFile)));
  return notes.filter((n): n is TodayActivityNote => n != null);
}
