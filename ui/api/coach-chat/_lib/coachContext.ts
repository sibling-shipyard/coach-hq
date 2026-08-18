/**
 * Translation layer between stored athlete data and the prompt text Gemini sees. Step 1 of the
 * coach-memory redesign (coach-redesign-part1-memory.md, Part 1). Sits on top of TODAY's files
 * (state.md, quest_log.md) and its output must be byte-for-byte identical to what
 * `buildDynamicText` already produces - proven by
 * `_tests/renderCoachContext-snapshot.test.ts` - before any file actually moves.
 *
 * Once profile.json/memory.json/injuries.json/sessions.json exist (Step 2+), this is the one
 * function whose internals swap to reading them - callers (coach-chat.ts) never need to change.
 */
import { buildDynamicText, type TurnMode } from "./coachPrompt.js";

// Bundles today's inputs to buildDynamicText under one name - "storage" per the spec, since this
// is what eventually becomes "the athlete's stored data" once Step 2 lands.
export interface CoachContextStorage {
  stateMd: string;
  questLog: string;
  extraContext?: string;
  useCache: boolean;
}

export function renderCoachContext(storage: CoachContextStorage, tier: TurnMode): string {
  return buildDynamicText(storage.stateMd, storage.questLog, tier, storage.extraContext, storage.useCache);
}
