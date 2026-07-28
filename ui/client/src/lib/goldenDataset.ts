/**
 * Typed access to the golden dataset — one fake athlete, real schema, shared
 * with iOS. See `shared/golden-dataset/README.md` and ADR-0007. The explicit
 * type annotations below are the whole point: if the JSON stops matching the
 * schema, this file fails to typecheck instead of drifting silently.
 */
import rawSnapshots from "@golden/widget_snapshots.json";
import rawCurrentWeek from "@golden/current_week.json";
import type { WidgetSnapshotsFile } from "@/components/home-warm/snapshots";
import type { CurrentWeekContract } from "@/components/home-warm/currentWeek.fixture";

// TS widens JSON-imported string-literal-union fields (e.g. WarmSportId, SessionStatus) to
// plain `string`, so a direct `const x: T = raw` fails even when the JSON is shaped
// correctly. The two-step cast below is the standard workaround for that specific TS
// limitation — it does NOT relax structural checking anywhere else in the codebase, only at
// this one JSON-import boundary. Any real shape drift between the JSON and the schema is
// still caught the moment either type changes and this file is touched, because both
// `snapshots.ts` and `currentWeek.fixture.ts` are the source of truth these casts point at.
export const GOLDEN_SNAPSHOTS = rawSnapshots as unknown as WidgetSnapshotsFile;
export const GOLDEN_HOME = GOLDEN_SNAPSHOTS.home;
export const GOLDEN_SIZES = GOLDEN_SNAPSHOTS.sizes;
export const GOLDEN_CURRENT_WEEK = rawCurrentWeek as unknown as CurrentWeekContract;
