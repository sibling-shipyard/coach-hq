/**
 * Thin command-line wrapper around compileWorkout() for the BYO Claude Code path (A4, #727).
 * The chat runtime reaches the same compiler through a bundle shim
 * (ui/api/coach-chat/_lib/compile-workout.bundle.js, built by
 * ui/scripts/bundle-compile-workout-api.mjs) - Claude Code has no JS import boundary to cross, so
 * it needs a plain CLI instead, and rest/prep-second timer physics belongs to the compiler, not
 * to whatever prose Coach would otherwise reason through by hand.
 *
 * Usage: npx tsx engine/scripts/compile-workout-cli.mts <spec.json>
 * Reads a WorkoutSpec JSON file, prints the compiled Workout JSON to stdout. Writes nothing -
 * saving the result to a session/template file is still Coach's call, same as any other write.
 */
import { readFileSync } from "node:fs";

import { compileWorkout, type WorkoutSpec } from "../lib/compileWorkout.mts";

function main(): void {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error("Usage: npx tsx engine/scripts/compile-workout-cli.mts <spec.json>");
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(specPath, "utf8");
  } catch (err) {
    console.error(`Could not read ${specPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  let spec: WorkoutSpec;
  try {
    spec = JSON.parse(raw) as WorkoutSpec;
  } catch (err) {
    console.error(`${specPath} is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    const workout = compileWorkout(spec);
    console.log(JSON.stringify(workout, null, 2));
  } catch (err) {
    console.error(`compileWorkout failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
