// Hand-written types for projectActivity.mjs. The engine band is plain JS by design (it is
// carved into coach-skeleton and runs without a build step), so consumers that typecheck —
// ui/'s test suite reads ACTIVITY_ALLOWLIST — need the shape declared rather than inferred.
export declare const ACTIVITY_ALLOWLIST: readonly string[];
export declare function projectActivity(
  activity: Record<string, unknown>,
): Record<string, unknown>;
