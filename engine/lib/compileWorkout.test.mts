import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileWorkout, type WorkoutSpec } from "./compileWorkout.mts";

const dir = dirname(fileURLToPath(import.meta.url));

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

function loadText(name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

function spec(partial: Partial<WorkoutSpec> & { phases: WorkoutSpec["phases"] }): WorkoutSpec {
  return {
    id: "t",
    title: "T",
    subtitle: "S",
    workout_type: "strength",
    location: "Home",
    equipment: [],
    coaching_note: "n",
    ...partial,
  };
}

function ex(
  name: string,
  fields: {
    type: "reps" | "timed";
    reps?: number;
    duration_secs?: number;
    sets: number;
    both_sides?: boolean;
    prep_secs?: number;
  },
) {
  return {
    name,
    form_cue: "cue",
    why: "why",
    ...fields,
  };
}

describe("compileWorkout", () => {
  it("golden — fixture spec compiles byte-identically to checked-in expected JSON", () => {
    const input = loadJson("compileWorkout.golden.spec.json") as WorkoutSpec;
    const actual = `${JSON.stringify(compileWorkout(input), null, 2)}\n`;
    expect(actual).toBe(loadText("compileWorkout.golden.expected.json"));
  });

  it("determinism — compiling the same spec twice deep-equals", () => {
    const input = loadJson("compileWorkout.golden.spec.json") as WorkoutSpec;
    expect(compileWorkout(input)).toEqual(compileWorkout(input));
  });

  it("numbering — exercises across three phases number 1..n with no gaps after a skip", () => {
    const workout = compileWorkout(
      spec({
        phases: [
          { name: "A", exercises: [ex("one", { type: "reps", reps: 5, sets: 1 })] },
          {
            name: "B",
            exercises: [ex("three", { type: "reps", reps: 5, sets: 1 })],
          },
          {
            name: "C",
            exercises: [
              ex("four", { type: "timed", duration_secs: 10, sets: 1 }),
              ex("five", { type: "reps", reps: 5, sets: 1 }),
            ],
          },
        ],
      }),
    );
    const nums = workout.phases.flatMap((p) => p.exercises.map((e) => e.num));
    expect(nums).toEqual([1, 2, 3, 4]);
    expect(workout.phases).toHaveLength(3);
    expect(workout.phases[1].exercises).toHaveLength(1);
  });

  it("duration math — a known spec yields the expected estimated_duration_mins", () => {
    // 1 timed exercise: 30s × 2 sets + 45s between-sets rest + 0 last rest = 105s → 2 min.
    const workout = compileWorkout(
      spec({
        phases: [
          {
            name: "Only",
            exercises: [ex("hold", { type: "timed", duration_secs: 30, sets: 2 })],
          },
        ],
      }),
    );
    expect(workout.estimated_duration_mins).toBe(2);
    expect(workout.phases[0].duration).toBe("2 min");
  });

  it("override — a spec that sets prep_secs: 0 on a timed exercise keeps 0", () => {
    const workout = compileWorkout(
      spec({
        phases: [
          {
            name: "Only",
            exercises: [ex("hang", { type: "timed", duration_secs: 15, sets: 1, prep_secs: 0 })],
          },
        ],
      }),
    );
    expect(workout.phases[0].exercises[0].prep_secs).toBe(0);
  });

  it("both_sides — doubles the work seconds, does not double sets", () => {
    const base = spec({
      phases: [
        {
          name: "Only",
          exercises: [ex("plank", { type: "timed", duration_secs: 40, sets: 1 })],
        },
      ],
    });
    const oneSide = compileWorkout(base);
    const both = compileWorkout({
      ...base,
      phases: [
        {
          name: "Only",
          exercises: [ex("plank", { type: "timed", duration_secs: 40, sets: 1, both_sides: true })],
        },
      ],
    });
    expect(oneSide.phases[0].exercises[0].sets).toBe(1);
    expect(both.phases[0].exercises[0].sets).toBe(1);
    expect(both.phases[0].exercises[0].both_sides).toBe(true);
    // 40s → 1 min; both_sides 80s → 2 min. Rest after last is 0.
    expect(oneSide.estimated_duration_mins).toBe(1);
    expect(both.estimated_duration_mins).toBe(2);
  });
});
