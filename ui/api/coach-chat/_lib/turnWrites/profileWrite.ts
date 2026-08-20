// profile_update: the profile.json write, plus the profile-completeness projection every turn
// needs to know whether this reply just finished First Session (ADR 0018's false->true trigger
// for coach_since / initial templates). Both live here because the projection is computed from
// the same profileUpdates this file's write applies - one usecase: "did this turn complete the
// athlete's profile."
import type { ResolvedFileWrite } from "../../../_lib/githubGitData.js";
import { getFileRaw, isAthleteProfileComplete, parseJsonOrNull } from "../coachChatFiles.js";
import { applyProfileUpdate, applySeasonStart, type ProfileUpdate } from "../coachIntents.js";
import {
  PROFILE_PATH,
  MEMORY_NOTE_LABELS,
  type ProfileJson,
  type MemoryJson,
  type CoachingStyle,
} from "../coachMemoryFiles.js";
import type { SeasonsJson } from "../coachQuestFiles.js";

// Typed as ResolvedFileWrite, not the broader FileEntry, so coachTurn.ts can access .resolve
// after this crosses a function-call boundary - TS only keeps that narrowing for object literals
// assigned inline to a FileEntry-typed const, not for one returned from a function.
export function buildProfileUpdateWrite(
  repo: string,
  token: string,
  profileUpdates: ProfileUpdate[],
): ResolvedFileWrite | undefined {
  if (profileUpdates.length === 0) return undefined;
  return {
    path: PROFILE_PATH,
    resolve: async () =>
      applyProfileUpdate(await getFileRaw(repo, PROFILE_PATH, token), profileUpdates),
  };
}

export interface ProfileProjection {
  wasProfileComplete: boolean;
  profileComplete: boolean;
  projectedProfile: ProfileJson;
  projectedMemory: MemoryJson;
}

export function projectProfileCompletion(params: {
  profile: ProfileJson | null;
  memory: MemoryJson | null;
  seasons: SeasonsJson | null;
  profileUpdates: ProfileUpdate[];
  sportsUpdate: string[];
  hasSportsUpdate: boolean;
  coachingStyleUpdate: CoachingStyle | undefined;
  seasonStart: Parameters<typeof applySeasonStart>[1] | undefined;
  traceId: string;
}): ProfileProjection {
  const {
    profile,
    memory,
    seasons,
    profileUpdates,
    sportsUpdate,
    hasSportsUpdate,
    coachingStyleUpdate,
    seasonStart,
    traceId,
  } = params;

  const wasProfileComplete = isAthleteProfileComplete(profile, memory, seasons);
  const projectedField = (field: ProfileUpdate["field"]) =>
    profileUpdates.find((update) => update.field === field)?.value;
  const projectedProfile: ProfileJson = {
    version: 1,
    coach_since: profile?.coach_since ?? null,
    name: (projectedField("name") as string | undefined) ?? profile?.name ?? "",
    dob: (projectedField("dob") as string | undefined) ?? profile?.dob ?? null,
    timezone:
      (projectedField("timezone") as string | undefined) ?? profile?.timezone ?? "UTC",
    height_cm:
      projectedField("height_cm") != null
        ? Number(projectedField("height_cm"))
        : (profile?.height_cm ?? null),
    weight_kg:
      projectedField("weight_kg") != null
        ? Number(projectedField("weight_kg"))
        : (profile?.weight_kg ?? null),
  };
  const projectedMemory: MemoryJson = {
    version: 1,
    _meta: memory?._meta ?? {
      updated_at: "",
      updated_by: "model",
      trace_id: "",
    },
    sports: hasSportsUpdate ? sportsUpdate : (memory?.sports ?? []),
    coaching_style: coachingStyleUpdate ?? memory?.coaching_style ?? null,
    notes:
      memory?.notes ??
      (Object.fromEntries(
        MEMORY_NOTE_LABELS.map((label) => [
          label,
          { text: "", updated_at: "", trace_id: "" },
        ]),
      ) as MemoryJson["notes"]),
  };
  const projectedSeasons = seasonStart?.name?.trim()
    ? parseJsonOrNull<SeasonsJson>(
        applySeasonStart(
          seasons ? JSON.stringify(seasons) : null,
          seasonStart,
          traceId,
          new Date(),
        ),
      )
    : seasons;
  const profileComplete = isAthleteProfileComplete(
    projectedProfile,
    projectedMemory,
    projectedSeasons,
  );

  return { wasProfileComplete, profileComplete, projectedProfile, projectedMemory };
}
