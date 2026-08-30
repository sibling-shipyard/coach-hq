/** Server-owned coach_since stamping at the First Session completion boundary. */
import { applyJsonMergePatch } from "../../_lib/fileEdits.js";
import { getFileRaw } from "./coachChatFiles.js";
import { todayDateString } from "./coachDay.js";
import { PROFILE_PATH } from "./coachMemoryFiles.js";

export interface ClosingFileContext {
  profile: string | null;
}

export async function loadClosingFileContext(
  repo: string,
  token: string,
): Promise<ClosingFileContext> {
  const profile = await getFileRaw(repo, PROFILE_PATH, token);
  return { profile };
}

// ADR 0018: stamp once on the incomplete-to-complete transition. The caller must merge this with
// any profile_update write because commitFilesAtomic does not merge duplicate paths.
export function injectCoachSinceIfNeeded(
  validUpdates: { path: string; content: string }[],
  closingFiles: ClosingFileContext | undefined,
  wasProfileComplete: boolean,
  isProfileCompleteNow: boolean,
  timezone: string,
): { path: string; content: string }[] {
  if (wasProfileComplete || !isProfileCompleteNow || !closingFiles) return validUpdates;
  const existing = validUpdates.find((u) => u.path === PROFILE_PATH);
  const baseContent = existing?.content ?? closingFiles.profile;
  try {
    const parsed = baseContent ? JSON.parse(baseContent) : {};
    if (parsed.coach_since) return validUpdates;
  } catch {
    console.warn("[coach-chat] profile.json unparsable - skipping coach_since stamp");
    return validUpdates;
  }
  const patch = JSON.stringify({
    coach_since: todayDateString(timezone, new Date()),
  });
  const result = applyJsonMergePatch(baseContent ?? null, patch);
  if (!result.ok) {
    console.warn(`[coach-chat] coach_since stamp failed - ${result.error}`);
    return validUpdates;
  }
  const rest = validUpdates.filter((u) => u.path !== PROFILE_PATH);
  return [...rest, { path: PROFILE_PATH, content: result.content }];
}
