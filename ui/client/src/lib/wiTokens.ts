import tokens from "@warm-instrument/tokens.json";

export type SportTokenId = keyof typeof tokens.sports;
export type WorkoutTokenId = keyof typeof tokens.workouts;

export function sportHex(id: SportTokenId): string {
  return tokens.sports[id].hex;
}

export function sportMixHex(id: SportTokenId): string {
  return tokens.sports[id].mixHex;
}

export function workoutHex(id: WorkoutTokenId): string {
  return tokens.workouts[id].hex;
}

export { tokens };
