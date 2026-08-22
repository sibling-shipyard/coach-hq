/**
 * Sport + workout colors from `shared/warm-instrument/tokens.json`.
 * iOS authored the hexes (`WarmInstrument.Sport`, `Theme.workoutColor`); web consumes them.
 */
import tokens from "@warm-instrument/tokens.json";

export const wiTokens = tokens;

export type SportId = keyof typeof tokens.sports;
export type WorkoutTokenId = keyof typeof tokens.workouts;

export function sportHex(id: SportId): string {
  return tokens.sports[id].hex;
}

export function sportMixHex(id: SportId): string {
  return tokens.sports[id].mixHex;
}

export function workoutHex(id: WorkoutTokenId): string {
  return tokens.workouts[id].hex;
}
