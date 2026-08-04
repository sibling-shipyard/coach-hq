// new HealthKit scalar → add here; new time series → do not.
export const ACTIVITY_ALLOWLIST = [
  "id",
  "id_str",
  "name",
  "category",
  "sport_type",
  "start_date_local",
  "elapsed_time",
  "moving_time",
  "calories",
  "distance",
  "total_elevation_gain",
  "average_heartrate",
  "max_heartrate",
  "has_heartrate",
  "hr_zones",
  "description",
  "max_speed",
  "device_name",
  "source",
  "pre_mental_state",
];

export function projectActivity(activity) {
  if (!activity) return activity;
  const projected = {};
  for (const field of ACTIVITY_ALLOWLIST) {
    if (activity[field] !== undefined) {
      projected[field] = activity[field];
    }
  }
  return projected;
}
