/**
 * Edge-case variants for `/gallery` only — states that aren't part of one coherent
 * athlete week, so they don't belong in the golden dataset. Baseline data for the
 * gallery comes from `@/lib/goldenDataset`.
 */
import type { Vo2Snapshot } from "./snapshots";

export const GALLERY_VO2_EMPTY: Vo2Snapshot = {
  status: "unavailable",
  value: null,
  delta: null,
  trend: [],
  read: "No Apple Health VO₂ observations yet.",
};
