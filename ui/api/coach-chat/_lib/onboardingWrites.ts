import type { MemoryJson, ProfileJson } from "./coachMemoryFiles.js";
import type { OnboardingHints } from "./coachPromptText.js";

export interface OnboardingChanges {
  name?: string;
  sports?: string[];
}

// Greet can be retried after Gemini fails. Compare exactly the normalized values the appliers
// persist so an already-successful deterministic write does not create another commit.
export function onboardingChanges(
  hints: OnboardingHints | undefined,
  profile: ProfileJson | null,
  memory: MemoryJson | null,
): OnboardingChanges {
  const name = hints?.name?.trim();
  const sports = (hints?.sports ?? []).map((sport) => sport.trim()).filter(Boolean);
  const currentSports = (memory?.sports ?? []).map((sport) => sport.trim()).filter(Boolean);

  return {
    name: name && name !== profile?.name?.trim() ? name : undefined,
    sports:
      sports.length > 0 &&
      (sports.length !== currentSports.length || sports.some((sport, index) => sport !== currentSports[index]))
        ? sports
        : undefined,
  };
}
