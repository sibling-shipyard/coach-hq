import type { WarmSportId } from "@/components/widgets";
import type { TrainingCategory } from "@/lib/activities";
import type { SessionDiscipline } from "./currentWeek.fixture";

export function trainingCategoryToSessionDiscipline(category: TrainingCategory): SessionDiscipline {
  if (category.startsWith("badminton")) return "badminton";
  if (category === "calisthenics") return "calisthenics";
  if (category === "ride") return "cycling";
  if (category === "foundation") return "foundation";
  if (category === "recovery" || category === "realign") return "recovery";
  if (category === "run") return "run";
  if (category === "strength") return "strength";
  if (category === "weight_training") return "weight_training";
  if (category === "hike") return "hike";
  if (category === "walk") return "walk";
  if (category === "cricket") return "cricket";
  if (category === "football") return "football";
  if (category === "workout") return "workout";
  if (category === "swim") return "swim";
  return "other";
}

export function trainingCategoryToWarmSport(category: TrainingCategory): WarmSportId {
  if (category.startsWith("badminton")) return "badminton";
  if (category === "calisthenics") return "calisthenics";
  if (category === "foundation" || category === "recovery" || category === "realign") {
    return "foundation";
  }
  if (category === "ride") return "cycling";
  if (category === "run") return "run";
  if (category === "strength") return "strength";
  if (category === "weight_training") return "weight_training";
  if (category === "hike") return "hike";
  if (category === "walk") return "walk";
  if (category === "cricket") return "cricket";
  if (category === "football") return "football";
  if (category === "workout") return "workout";
  if (category === "swim") return "swim";
  return "other";
}

export function sessionDisciplineToSnapshotSport(
  discipline: SessionDiscipline,
): WarmSportId | "recovery" {
  if (discipline === "cycling") return "cycling";
  if (discipline === "badminton") return "badminton";
  if (discipline === "calisthenics") return "calisthenics";
  if (discipline === "foundation") return "foundation";
  if (discipline === "recovery") return "recovery";
  if (discipline === "run") return "run";
  if (discipline === "strength") return "strength";
  if (discipline === "weight_training") return "weight_training";
  if (discipline === "hike") return "hike";
  if (discipline === "walk") return "walk";
  if (discipline === "cricket") return "cricket";
  if (discipline === "football") return "football";
  if (discipline === "workout") return "workout";
  if (discipline === "swim") return "swim";
  return "other";
}

/** Runtime discipline is a free string; collapse it onto the session contract enum. */
export function normaliseRuntimeDiscipline(discipline: string): SessionDiscipline {
  const value = discipline.toLowerCase();
  if (value.includes("badminton")) return "badminton";
  if (value.includes("calisthenic")) return "calisthenics";
  if (value === "cycling" || value === "ride" || value === "bike") return "cycling";
  if (value === "foundation") return "foundation";
  if (value === "recovery" || value === "realign" || value === "mobility") return "recovery";
  if (value === "run" || value === "running") return "run";
  if (value === "strength") return "strength";
  if (value === "weight_training" || value === "weights" || value === "weight training") {
    return "weight_training";
  }
  if (value === "hike" || value === "hiking") return "hike";
  if (value === "walk" || value === "walking") return "walk";
  if (value === "cricket") return "cricket";
  if (value === "football" || value === "soccer") return "football";
  if (value === "workout") return "workout";
  if (value === "swim" || value === "swimming") return "swim";
  return "other";
}
