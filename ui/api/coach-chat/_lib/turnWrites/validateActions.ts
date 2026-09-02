/**
 * D1 layer 3 (#736): pre-validate referential-id actions before any write is built, instead of
 * relying on the applier's own throw-inside-commitFilesAtomic's-blob-resolve-closure guard
 * (coachIntents.ts's applyQuestEvent/applyInjuryEvent) to abort the whole atomic commit on one
 * bad reference. By the time a reply reaches buildTurnWrites it has already passed layer 1's
 * enum-constrained generation and layer 2's one-shot corrective retry (coachTurn.ts) - what's
 * left here is the rare id that still doesn't resolve (a stale/hallucinated one, or the
 * underlying file changed between context load and reply). Filtering here, before the write is
 * ever built, means the applier's own throw guard should never fire in normal operation; it stays
 * in place purely as defense in depth.
 */
import type { QuestEvent, InjuryEvent } from "../coachIntents.js";

export interface DroppedAction {
  field: string;
  reason: string;
}

export function validateQuestEvents(
  events: QuestEvent[],
  validQuestIds: ReadonlySet<string>,
): { valid: QuestEvent[]; dropped: DroppedAction[] } {
  const valid: QuestEvent[] = [];
  const dropped: DroppedAction[] = [];
  for (const event of events) {
    if (validQuestIds.has(event.quest_id)) {
      valid.push(event);
    } else {
      dropped.push({
        field: "quest_event",
        reason: `no quest with id "${event.quest_id}" - it may be stale or hallucinated`,
      });
    }
  }
  return { valid, dropped };
}

export function validateInjuryEvents(
  events: InjuryEvent[],
  validFlagIds: ReadonlySet<string>,
): { valid: InjuryEvent[]; dropped: DroppedAction[] } {
  const valid: InjuryEvent[] = [];
  const dropped: DroppedAction[] = [];
  for (const event of events) {
    if (validFlagIds.has(event.flag_id)) {
      valid.push(event);
    } else {
      dropped.push({
        field: "injury_event",
        reason: `no injury flag with id "${event.flag_id}" - it may be stale or hallucinated`,
      });
    }
  }
  return { valid, dropped };
}
