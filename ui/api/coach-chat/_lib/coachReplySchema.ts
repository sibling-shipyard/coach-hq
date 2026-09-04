/**
 * Gemini reply types and mode-specific structured-output schemas. Pure configuration; prompt
 * wording lives in coachPromptText.ts.
 *
 * coach-chat-reliability-debug: stripped to the smallest reliable ask - a plain conversation,
 * plus a short append-only note on close. No file_updates, checklist gate, retry/honesty guard,
 * or title. `reasoning` removed too - it was suspected of acting as a release valve, letting the
 * model narrate intent there instead of committing it to coach_note.
 */
import { MEMORY_NOTE_LABELS, type MemoryNoteLabel } from "./coachMemoryFiles.js";
import type { WeekPlan, SessionReconcileEvent, PlanEditEvent } from "./coachWeekFiles.js";
import {
  COACH_LOG_TEXT_CAP,
  MEMORY_NOTE_TEXT_CAP,
  INJURY_FLAG_TEXT_CAP,
} from "./text-caps.bundle.js";

export interface GeminiReply {
  reply: string;
  // See responseSchema's coach_note and coachIntents.ts's applyCoachNote.
  coach_note?: string;
  // See responseSchema's memory_update and coachIntents.ts's applyMemoryUpdate.
  memory_update?: { label: MemoryNoteLabel; text: string };
  // See responseSchema's coaching_style_update for rationale and legal values.
  coaching_style_update?: "accountability" | "encouragement" | "analysis";
  // See responseSchema's sports_update for rationale.
  sports_update?: string[];
  // See responseSchema's injury_flag for rationale - a brand-new injury the athlete has
  // never mentioned before. No id: the server mints one, same discipline as quest_create.
  injury_flag?: { text: string }[];
  // See responseSchema's injury_event for the array rationale and wire shape. Update/resolve
  // only - flag_id is required and must be a real id already shown in the athlete's injuries
  // context. A brand-new injury goes through injury_flag instead.
  injury_event?: { status: "active" | "resolved"; text?: string; flag_id: string }[];
  // See responseSchema's quest_event for the array, server-owned fields, and value rationale.
  quest_event?: { quest_id: string; status: "completed" | "missed" | "excused"; value?: string }[];
  // See responseSchema's profile_update for the array and value rationale.
  profile_update?: {
    field: "name" | "dob" | "timezone" | "height_cm" | "weight_kg";
    value: string;
  }[];
  // See responseSchema's template_edit for rationale and wire shape.
  template_edit?: {
    template_id: string;
    skip_exercise_nums?: number[];
    skip_phases?: string[];
    note?: string;
  };
  // See responseSchema's session_plan for the server-owned date and skip_phases rationale.
  session_plan?: {
    template_id: string;
    skip_exercise_nums?: number[];
    skip_phases?: string[];
    note?: string;
  };
  // See responseSchema's week_plan and coachWeekFiles.ts's applyWeekPlan.
  week_plan?: WeekPlan;
  // See responseSchema's session_reconcile and SessionReconcileEvent.
  session_reconcile?: SessionReconcileEvent[];
  // See responseSchema's plan_edit and PlanEditEvent.
  plan_edit?: PlanEditEvent[];
  // See responseSchema's season_start for scope and rationale. main_quest is bundled in, not
  // optional (B3) - a season without a fixed goal for its duration isn't really a season, and
  // the two now always move as one unit, always.
  season_start?: {
    name: string;
    start_date: string;
    end_date: string;
    main_quest: {
      name: string;
      type: "daily_streak" | "progress" | "count_target" | "weekly_frequency";
      target: number;
      count_pattern?: string;
    };
  };
  // See responseSchema's quest_create for scope and rationale. Habit quests only (B3) - the main
  // goal moved to season_start.main_quest; there is no standalone way to set it here anymore.
  quest_create?: {
    quests?: {
      name: string;
      type: "daily_streak" | "progress" | "count_target" | "weekly_frequency";
      polarity?: "default_done" | "default_not_done";
      target?: number;
      unit?: string;
    }[];
  };
}

// Every turn commits whatever it produces - there is no separate mode for a turn that closes a
// session, so every non-greeting, non-activity_sync turn is just "ordinary".
export type TurnMode = "greeting" | "ordinary" | "activity_sync";

const RESPONSE_PROPERTIES = {
  // Commitment fields declared before reply (gemini-flow.md's Action-field design rule #4).
  // Continuity note for coach_log.json, never shown to the athlete - day-keyed overwrite
  // (coachIntents.ts's applyCoachNote), available on every ordinary turn.
  coach_note: { type: "string", maxLength: COACH_LOG_TEXT_CAP },
  // Replaces one of memory.json's constrained labelled note boxes in full.
  memory_update: {
    type: "object",
    properties: {
      label: { type: "string", enum: [...MEMORY_NOTE_LABELS] },
      text: { type: "string", maxLength: MEMORY_NOTE_TEXT_CAP },
    },
  },
  // Constrained enum, not free text - matches B_engine.md's real FSP intake question
  // ("What works when things get hard?"). Also written by First Session Protocol; this is the
  // chat-editable path for changing it later.
  coaching_style_update: {
    type: "string",
    enum: ["accountability", "encouragement", "analysis"],
  },
  // Separate top-level memory.json field, not a labelled memory note. First Session Protocol
  // writes it when first stated; later chat may replace the full list.
  sports_update: { type: "array", items: { type: "string" } },
  // A brand-new injury the athlete has never mentioned before. No id in the wire shape -
  // server mints one (coachIntents.ts's applyInjuryFlag), same discipline as quest_create.
  // Split from injury_event (#693): a single optional-id field let Gemini invent a flag_id for
  // a new injury, which injury_event's existing-match-or-throw guard then rejected every time.
  injury_flag: {
    type: "array",
    items: {
      type: "object",
      properties: {
        text: { type: "string", maxLength: INJURY_FLAG_TEXT_CAP },
      },
      required: ["text"],
    },
  },
  // Update or resolve a flag already on file - flag_id required and must be a real id from the
  // athlete's injuries context (activeInjuryFlagsSection in coachContext.ts). Array
  // (workout-backend-wiring live verification, same fix issue #410 already gave quest_event) -
  // a turn can report more than one injury update. A brand-new injury goes through injury_flag.
  injury_event: {
    type: "array",
    items: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "resolved"] },
        text: { type: "string", maxLength: INJURY_FLAG_TEXT_CAP },
        flag_id: { type: "string" },
      },
      required: ["status", "flag_id"],
    },
  },
  // Part 2 ledger split, step 3a - shipped and tested in isolation before profile_update
  // (gemini-flow.md's Action-field design rule #2). No `date` - server stamps it. Array
  // (issue #410) so a turn reporting several quest completions at once captures all of them.
  // value is string-only because that is all structured output can produce here.
  quest_event: {
    type: "array",
    items: {
      type: "object",
      properties: {
        quest_id: { type: "string" },
        status: { type: "string", enum: ["completed", "missed", "excused"] },
        value: { type: "string" },
      },
    },
  },
  // Part 2 ledger split, step 3b - shipped after quest_event confirmed working live.
  // Array (workout-backend-wiring live verification, same fix issue #410 already gave
  // quest_event) - a turn can report more than one profile field at once. value is
  // string-only because that is all structured output can produce here.
  profile_update: {
    type: "array",
    items: {
      type: "object",
      properties: {
        field: { type: "string", enum: ["name", "dob", "timezone", "height_cm", "weight_kg"] },
        value: { type: "string" },
      },
      required: ["field", "value"],
    },
  },
  // Permanent structural removal from an existing template. Single object: one edit per turn.
  // Free-form generation was removed because its second model call doubled the failure surface;
  // unsupported additions must not be represented as edits.
  // template_id is free text in the schema itself - C1 stopped feeding Gemini a live template-id
  // list on every turn (that fetch is now lazy, only after a reply actually asks for one of
  // these fields - see coachTurn.ts's buildTurnWrites); coachWorkoutFiles.ts's applyTemplateEdit
  // against the real manifest, fetched at that point, is the actual enforcement point.
  template_edit: {
    type: "object",
    properties: {
      template_id: { type: "string" },
      skip_exercise_nums: { type: "array", items: { type: "number" } },
      skip_phases: { type: "array", items: { type: "string" } },
      note: { type: "string" },
    },
    required: ["template_id"],
  },
  // Today's modified session from an existing template. Single object: one prescription per
  // turn. The server stamps session_date, deliberately limiting this action to today;
  // future-dated prescriptions require an explicit later schema change. skip_phases is plain
  // language because Gemini does not receive full template exercise numbers; the server
  // resolves the phase against the real template at commit time.
  session_plan: {
    type: "object",
    properties: {
      template_id: { type: "string" },
      skip_exercise_nums: { type: "array", items: { type: "number" } },
      skip_phases: { type: "array", items: { type: "string" } },
      note: { type: "string" },
    },
    // template_id is the only field the write guard in coachTurn.ts actually needs
    // (skip_exercise_nums/note are genuinely optional content) - required here so Gemini
    // can't set this field at all without it, same "no silently-partial commitment object"
    // discipline as template_edit above.
    required: ["template_id"],
  },
  // coach-redesign workout-backend-wiring §5 - single object, the Weekly Kick-off Ritual's
  // full seven-day rewrite. priority/planned_duration_min/template_id are all optional per
  // session (server fills in a default priority, see coachWeekFiles.ts's
  // DEFAULT_SESSION_PRIORITY, when Gemini leaves it out). No enum "null" option for priority -
  // Gemini simply omits the field when it doesn't have a clear call.
  week_plan: {
    type: "object",
    properties: {
      focus: { type: "string" },
      guardrails: { type: "array", items: { type: "string" } },
      headline: { type: "string" },
      body: { type: "string" },
      days: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" },
            intent: { type: "string" },
            sessions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  discipline: { type: "string" },
                  kind: { type: "string" },
                  title: { type: "string" },
                  priority: { type: "string", enum: ["anchor", "support", "optional"] },
                  planned_duration_min: { type: "number" },
                  template_id: { type: "string" },
                },
                required: ["discipline", "kind", "title"],
              },
            },
          },
          required: ["date", "sessions"],
        },
      },
    },
    required: ["headline", "body", "days"],
  },
  // coach-redesign workout-backend-wiring §5 - array, mirrors quest_event's shape.
  // session_id must be one of the ids listed in context (activeWeekSessionsContext below) -
  // never invented. `actual` only when what happened differs from what was planned.
  session_reconcile: {
    type: "array",
    items: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        status: { type: "string", enum: ["done", "skipped"] },
        activity_ids: { type: "array", items: { type: "string" } },
        actual: {
          type: "object",
          properties: {
            discipline: { type: "string" },
            kind: { type: "string" },
            title: { type: "string" },
            template_id: { type: "string" },
          },
          required: ["discipline", "kind", "title"],
        },
      },
      required: ["session_id", "status"],
    },
  },
  // coach-redesign workout-backend-wiring §5 follow-up - array, edits an existing session's
  // planned content without a full week_plan rewrite. session_id must be one of the ids
  // listed in context (activeWeekSessionsContext below) - never invented.
  plan_edit: {
    type: "array",
    items: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        discipline: { type: "string" },
        kind: { type: "string" },
        title: { type: "string" },
        template_id: { type: "string" },
      },
      required: ["session_id", "discipline", "kind", "title"],
    },
  },
  // Available to every athlete, first session or returning (B3) - starts a new season and its
  // goal together, one atomic action. main_quest is required, not optional: starting a season
  // without a goal, or setting a goal without starting a season, are both structurally
  // impossible now, not just discouraged in the prompt. The server resolves the outgoing
  // season's status and retires its old main_quest into quests.json in the same commit -
  // coachIntents.ts's applySeasonStart.
  season_start: {
    type: "object",
    properties: {
      name: { type: "string" },
      start_date: { type: "string" },
      end_date: { type: "string" },
      main_quest: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["daily_streak", "progress", "count_target", "weekly_frequency"],
          },
          target: { type: "number" },
          count_pattern: { type: "string" },
        },
        required: ["name", "type", "target"],
      },
    },
    required: ["name", "start_date", "end_date", "main_quest"],
  },
  // Available to every athlete, first session or returning (B3) - habit quests only. The main
  // goal moved to season_start.main_quest (above); there is no field here to set it anymore, so
  // a goal change without an actual season change is structurally impossible.
  quest_create: {
    type: "object",
    properties: {
      quests: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: {
              type: "string",
              enum: ["daily_streak", "progress", "count_target", "weekly_frequency"],
            },
            polarity: { type: "string", enum: ["default_done", "default_not_done"] },
            target: { type: "number" },
            unit: { type: "string" },
          },
          required: ["name", "type"],
        },
      },
    },
  },
  reply: { type: "string" },
} as const;

type ResponseField = keyof typeof RESPONSE_PROPERTIES;

const FSP_ACTIONS = [
  "coach_note",
  "memory_update",
  "coaching_style_update",
  "sports_update",
  "injury_flag",
  "injury_event",
  "profile_update",
  "season_start",
  "quest_create",
] as const satisfies readonly ResponseField[];

// Available on every turn for a returning athlete (#616 unlocked the data-fact half; C1 folds
// the session-artifact half in too - there is no more closing ritual to gate them behind).
// season_start and quest_create joined the data-fact half in B3 - a returning athlete can start
// a new season with its goal, or add a habit quest, the same as during First Session, any turn.
// coach_note is here too - day-keyed (coachIntents.ts's applyCoachNote), available on every
// returning turn; coachTurn.ts enforces it's present whenever another structured write fires
// this turn.
const RETURNING_ACTIONS = [
  "coach_note",
  "memory_update",
  "coaching_style_update",
  "sports_update",
  "injury_flag",
  "injury_event",
  "quest_event",
  "profile_update",
  "season_start",
  "quest_create",
  "template_edit",
  "session_plan",
  "week_plan",
  "session_reconcile",
  "plan_edit",
] as const satisfies readonly ResponseField[];

function responsePropertiesFor(mode: TurnMode, firstSession: boolean) {
  const actionFields: readonly ResponseField[] =
    mode === "greeting" || mode === "activity_sync"
      ? []
      : firstSession
        ? FSP_ACTIONS
        : RETURNING_ACTIONS;
  const fields: ResponseField[] = [...actionFields, "reply"];
  return Object.fromEntries(fields.map((key) => [key, RESPONSE_PROPERTIES[key]]));
}

// D1 layer 1 (#736): quest_event.quest_id and injury_event.flag_id are the referential-id class
// of bug #693 - free-text fields Gemini can hallucinate. Gemini's structured-output mode already
// enforces `enum` server-side for the other constrained fields above; this makes a bad reference
// structurally impossible to generate in the common case by threading that athlete's actual
// current ids in as a real enum, scoped to this one request. Deep-clones RESPONSE_PROPERTIES's
// affected leaves rather than mutating the shared const - generationConfigFor is called fresh
// per request and must never leak one athlete's ids into another's cached schema shape.
export interface AthleteReferenceIds {
  questIds?: readonly string[];
  injuryFlagIds?: readonly string[];
}

function withReferenceEnums(
  properties: Record<string, unknown>,
  ids: AthleteReferenceIds | undefined,
): Record<string, unknown> {
  if (!ids) return properties;
  const next = { ...properties };
  // An empty enum is a schema Gemini can't satisfy at all (every id would be "not in []") - only
  // constrain when there's at least one real id to reference. No ids means the athlete has no
  // quests/injuries yet, so the free-text field (and the existing throw-based guard downstream)
  // stays the only defense, same as before this layer existed.
  if (ids.questIds && ids.questIds.length > 0 && next.quest_event) {
    const questEvent = next.quest_event as { items: { properties: Record<string, unknown> } };
    next.quest_event = {
      ...questEvent,
      items: {
        ...questEvent.items,
        properties: {
          ...questEvent.items.properties,
          quest_id: { type: "string", enum: [...ids.questIds] },
        },
      },
    };
  }
  if (ids.injuryFlagIds && ids.injuryFlagIds.length > 0 && next.injury_event) {
    const injuryEvent = next.injury_event as { items: { properties: Record<string, unknown> } };
    next.injury_event = {
      ...injuryEvent,
      items: {
        ...injuryEvent.items,
        properties: {
          ...injuryEvent.items.properties,
          flag_id: { type: "string", enum: [...ids.injuryFlagIds] },
        },
      },
    };
  }
  return next;
}

/** The smallest legal response shape for this turn; forbidden actions are absent structurally. */
export function generationConfigFor(
  mode: TurnMode,
  firstSession: boolean,
  ids?: AthleteReferenceIds,
) {
  return {
    responseMimeType: "application/json",
    // A complex returning turn can legitimately combine several actions. Smaller modes keep the
    // same ceiling; the schema, not truncation pressure, controls their output.
    maxOutputTokens: 4096,
    responseSchema: {
      type: "object",
      properties: withReferenceEnums(responsePropertiesFor(mode, firstSession), ids),
      required: ["reply"],
    },
  } as const;
}
