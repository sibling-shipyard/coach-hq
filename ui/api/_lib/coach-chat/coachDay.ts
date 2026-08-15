/**
 * Timezone/day-number math for coach-chat: the athlete's own IANA timezone (read out of state.md,
 * not the server's), calendar-day offsets for thread age labels, and the ADR 0018 coach_since
 * day-number anchor. All pure - no I/O, no GitHub/Gemini calls.
 */
import type { ChatThread } from "./chatThreads.js";

// Matches SOUL.md §1 step 6's `TZ=<timezone> date` - the web chat has no shell, so this is
// the direct equivalent: pull the IANA zone out of state.md's Athlete Profile line
// (`- **Timezone:** Asia/Kolkata (IST, UTC+5:30)`) and format "today" in it, falling back to
// UTC the same way SOUL.md's own boot sequence does when the field isn't set yet.
function extractTimezone(stateMd: string): string {
  const match = stateMd.match(/\*\*Timezone:\*\*\s*([A-Za-z_]+\/[A-Za-z_]+)/);
  return match?.[1] ?? "UTC";
}

// Calendar-day difference between a thread's createdAt and "today," both resolved in the
// athlete's own timezone (state.md's Timezone field) rather than UTC - a thread created at
// 11pm IST shouldn't already read as "yesterday" just because UTC has rolled over. Falls back
// to 0 (same behavior as before this existed) if the timezone can't be resolved.
function computeDayOffset(createdAt: number, stateMd: string): number {
  const timezone = extractTimezone(stateMd);
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

// ageLabel is only ever written once, at thread-creation/close time (both call sites just set
// "NOW"), so without this it freezes there forever - an old thread would say "NOW" for good.
// Recompute it here from the freshly-computed dayOffset instead of trusting the stored value.
// Matches threadDayLabel's "D-N" convention (coachChatModel.ts) rather than inventing new copy.
function ageLabelFor(dayOffset: number): string {
  return dayOffset === 0 ? "NOW" : `D-${dayOffset}`;
}

export function withComputedDayOffsets(threads: ChatThread[], stateMd: string): ChatThread[] {
  return threads.map((t) => {
    const dayOffset = computeDayOffset(t.createdAt ?? Date.now(), stateMd);
    return { ...t, dayOffset, ageLabel: ageLabelFor(dayOffset) };
  });
}

export function todayContextLine(stateMd: string): string {
  const timezone = extractTimezone(stateMd);
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

// A divider message's label was a bare "TODAY" before this - inconsistent with the richer
// "TODAY · D-143 · 6:58" format iOS's own preview/mock data models (CoachChatPreviewData.swift).
// Day number isn't threaded into the divider label (that's still computed client-side from
// challenge_v2.json), but the time-of-day is - include at least that, applied identically
// everywhere a divider gets created (greet and close) so they never disagree with each other.
export function todayDividerLabel(stateMd: string): string {
  const timezone = extractTimezone(stateMd);
  try {
    const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(
      new Date(),
    );
    return `TODAY · ${time}`;
  } catch {
    return "TODAY";
  }
}

// Today's date as YYYY-MM-DD in the athlete's own timezone (state.md's Timezone field) - used
// to stamp coach_since (ADR 0018) and to date a coach_note entry, so the date matches what the
// athlete would call "today" even close to midnight, not whatever day it is in the server's UTC
// clock.
export function todayDateString(stateMd: string, now: Date): string {
  const timezone = extractTimezone(stateMd);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

// ADR 0018: coach_since is a durable, write-once anchor - "days since this athlete started using
// Coach at all," independent of season/challenge resets. Falls back to season.start_date, then
// challenge.start_date, for repos that haven't been stamped yet (pre-existing athletes awaiting
// manual backfill, or a session mid-First-Session-Protocol before coach_since exists). Returns
// null if none of the three are present, rather than inventing a day number from nothing.
// coach-chat-reliability-debug: no longer called from the closing-turn prompt (there's no more
// commit_message field to thread a day-N reference into) - kept exported/tested as-is per
// instruction not to touch coach_since-adjacent wiring, in case a day-N surface reappears.
export function coachDayNumber(challengeJson: string | null | undefined, stateMd: string, now: Date): number | null {
  if (!challengeJson) return null;
  let parsed: { coach_since?: string; season?: { start_date?: string }; challenge?: { start_date?: string } };
  try {
    parsed = JSON.parse(challengeJson);
  } catch {
    return null;
  }
  const startRaw = parsed.coach_since ?? parsed.season?.start_date ?? parsed.challenge?.start_date;
  if (!startRaw) return null;
  const timezone = extractTimezone(stateMd);
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
