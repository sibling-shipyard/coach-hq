// Server-side corrections the athlete never sees: a skip_phases name that matched nothing, a
// hallucinated template_id nulled out, a discipline coerced to "other", a quest_event the server
// synthesized. Each used to reach console.warn only, so a reply that narrated a change the server
// quietly did not apply was invisible in Sentry. The appliers that hit these run synchronously
// inside a write's resolve(), where a flushed Sentry call can't be awaited, so they record here
// and commitTurn flushes once per turn after the facts commit.
import { captureServerMessage } from "../../../_lib/sentry.js";

export type SilentFixupKind =
  | "phase_no_match"
  | "phase_ambiguous"
  | "template_id_nulled"
  | "discipline_coerced"
  | "quest_event_synthesized"
  | "coach_note_synthesized"
  | "reprompt_fields_carried";

export interface SilentFixup {
  kind: SilentFixupKind;
  /** The action field involved, e.g. "session_plan" or "template_edit". */
  action: string;
  detail: string;
}

// A turn that throws before commitTurn never flushes, so cap the map instead of trusting cleanup.
const MAX_PENDING_TRACES = 200;
const pending = new Map<string, SilentFixup[]>();

export function recordSilentFixup(traceId: string | undefined, fixup: SilentFixup): void {
  if (!traceId) return;
  const existing = pending.get(traceId);
  if (existing) {
    existing.push(fixup);
    return;
  }
  if (pending.size >= MAX_PENDING_TRACES) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.set(traceId, [fixup]);
}

export async function flushSilentFixups(traceId: string | undefined): Promise<void> {
  if (!traceId) return;
  const fixups = pending.get(traceId);
  pending.delete(traceId);
  if (!fixups || fixups.length === 0) return;
  const kinds = [...new Set(fixups.map((fixup) => fixup.kind))];
  await captureServerMessage(`coach-chat silent fixup: ${kinds.join(", ")}`, {
    level: "warning",
    tags: { vercel_trace_id: traceId, fixup_kinds: kinds.join(",") },
    contexts: { coach_turn: { fixups } },
  });
}
