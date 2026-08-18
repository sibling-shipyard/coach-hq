/**
 * Timezone/day-number math for coach-chat: calendar-day offsets for thread age labels, and the
 * ADR 0018 coach_since day-number anchor. All pure - no I/O, no GitHub/Gemini calls.
 *
 * Every function here takes the athlete's IANA timezone directly (profile.json's `timezone`
 * field, read by the caller) rather than parsing it out of state.md prose - state.md no longer
 * exists (coach-redesign-part1-memory.md, Part 1).
 */
import type { ApiChatThread, ChatThread } from "./chatThreads.js";

// Calendar-day difference between a thread's createdAt and "today," both resolved in the
// athlete's own timezone rather than UTC - a thread created at 11pm IST shouldn't already read
// as "yesterday" just because UTC rolled over.
function computeDayOffset(createdAt: number, timezone: string): number {
  try {
    const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }); // YYYY-MM-DD, sortable
    const createdDay = dayFormatter.format(new Date(createdAt));
    const todayDay = dayFormatter.format(new Date());
    const createdUTC = Date.parse(`${createdDay}T00:00:00Z`);
    const todayUTC = Date.parse(`${todayDay}T00:00:00Z`);
    return Math.max(0, Math.round((todayUTC - createdUTC) / 86_400_000));
  } catch {
    return 0;
  }
}

// ageLabel is only ever written once at creation/close time (always "NOW"), so it freezes there
// unless recomputed here from the fresh dayOffset. Matches coachChatModel.ts's "D-N" convention.
function ageLabelFor(dayOffset: number): string {
  return dayOffset === 0 ? "NOW" : `D-${dayOffset}`;
}

export function withComputedDayOffsets(threads: ChatThread[], timezone: string): ApiChatThread[] {
  return threads.map((t) => {
    const dayOffset = computeDayOffset(t.createdAt ?? Date.now(), timezone);
    return { ...t, dayOffset, ageLabel: ageLabelFor(dayOffset), status: "active" };
  });
}

export function todayContextLine(timezone: string): string {
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
    return `Today is ${formatted} (${timezone}).`;
  } catch {
    return `Today is ${new Date().toISOString()} (UTC - couldn't resolve "${timezone}" as a timezone).`;
  }
}

export function todayDividerLabel(timezone: string): string {
  try {
    const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(
      new Date(),
    );
    return `TODAY · ${time}`;
  } catch {
    return "TODAY";
  }
}

// Used to stamp coach_since (ADR 0018) and date a coach_log.json row in the athlete's own
// timezone, not the server's UTC clock.
export function todayDateString(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

// ADR 0018: coach_since is a durable, write-once anchor - "days since this athlete started using
// Coach at all," independent of season/challenge resets. Falls back to season.start_date, then
// challenge.start_date, for repos not yet stamped. Not currently called from the closing-turn
// prompt (kept exported/tested in case a day-N surface reappears).
export function coachDayNumber(challengeJson: string | null | undefined, timezone: string, now: Date): number | null {
  if (!challengeJson) return null;
  let parsed: { coach_since?: string; season?: { start_date?: string }; challenge?: { start_date?: string } };
  try {
    parsed = JSON.parse(challengeJson);
  } catch {
    return null;
  }
  const startRaw = parsed.coach_since ?? parsed.season?.start_date ?? parsed.challenge?.start_date;
  if (!startRaw) return null;
  try {
    const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    const startDay = dayFormatter.format(new Date(`${startRaw}T00:00:00Z`));
    const todayDay = dayFormatter.format(now);
    const startUTC = Date.parse(`${startDay}T00:00:00Z`);
    const todayUTC = Date.parse(`${todayDay}T00:00:00Z`);
    if (Number.isNaN(startUTC) || Number.isNaN(todayUTC)) return null;
    return Math.max(1, Math.round((todayUTC - startUTC) / 86_400_000) + 1);
  } catch {
    return null;
  }
}
