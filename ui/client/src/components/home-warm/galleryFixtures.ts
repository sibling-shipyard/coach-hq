/**
 * Hand-authored, self-contained sample data for the internal Widget Gallery
 * (`/gallery`). Numbers mirror `docs/reference-interactions/Widget Gallery.dc.html`
 * and `Widget Interactions.dc.html` so the live React components read the same
 * as the design reference. Never wired to real repo data — do not import
 * outside the gallery page.
 */
import type {
  BuildPhaseSnapshot,
  CaloriesSnapshot,
  CoachReadSnapshot,
  CommitmentSnapshot,
  EngineSnapshot,
  QuestSnapshot,
  RecentSessionSnapshot,
  TrainingActivitySnapshot,
  Vo2Snapshot,
  WeeklyPlanSnapshot,
} from "./snapshots";

export const GALLERY_ENGINE: EngineSnapshot = {
  weekLabel: "WK 29",
  load: 549,
  signal: "IN BAND",
  verdict: "Optimal engine — hold here.",
  compactVerdict: "In the band.",
  openVerdict: "Hold here.",
  bandLow: 447,
  bandHigh: 671,
  scaleLow: 300,
  scaleHigh: 800,
  trend: [
    { label: "8 JUN", value: 520, weekLabel: "WK 24" },
    { label: "15 JUN", value: 490, weekLabel: "WK 25" },
    { label: "22 JUN", value: 430, weekLabel: "WK 26" },
    { label: "29 JUN", value: 560, weekLabel: "WK 27" },
    { label: "6 JUL", value: 545, weekLabel: "WK 28" },
    { label: "13 JUL", value: 549, weekLabel: "WK 29" },
  ],
  mix: [
    { id: "badminton", label: "Badminton", shortLabel: "BDM", hours: 3.8, color: "#9fc0ad" },
    { id: "foundation", label: "Foundation", shortLabel: "FDN", hours: 2.5, color: "#cdd3a8" },
    { id: "cycling", label: "Ride", shortLabel: "RIDE", hours: 0.4, color: "#e0b06e" },
  ],
  totalHours: 9.3,
  method: "LOAD = Σ(MIN × ZONE 1–5) · BAND = 8-WK RHYTHM ±20%",
  doseRows: [
    { day: "MON", title: "Hit & Run #33", detail: "1H50", load: 205, sport: "badminton" },
    { day: "TUE", title: "FL block", detail: "48M", load: 88, sport: "calisthenics" },
    { day: "THU", title: "Club night", detail: "2H05", load: 210, sport: "badminton" },
    { day: "SAT", title: "Easy loop", detail: "38M", load: 40, sport: "cycling" },
    { day: "SUN", title: "Hit & Run #35", detail: "1H55", load: 412, sport: "badminton" },
  ],
};

export const GALLERY_COMMITMENTS: CommitmentSnapshot[] = [
  {
    id: "badminton",
    label: "Badminton — 1 of 2 committed sessions this week, 8 wins 4 losses across all matches.",
    glyph: "badminton",
    value: 1,
    target: 2,
    note: "8W–4L",
    status: "ALL",
    progress: 67,
    accent: "#315a4a",
    allRecord: "8W–4L",
    rankedRecord: "5W–2L",
    hasRankedRecord: true,
  },
  {
    id: "calisthenics",
    label: "Calisthenics — 0 sessions this week, below the 2.5 floor. The bar is cold.",
    glyph: "calisthenics",
    value: 0,
    target: 2.5,
    note: "FLOOR 2.5",
    status: "BELOW",
    progress: 0,
    accent: "#4f587a",
    alarm: true,
  },
  {
    id: "foundation",
    label: "Foundation — 5 of 5 committed days this week, 83-day streak.",
    glyph: "foundation",
    value: 5,
    target: 5,
    note: "5/5 DAYS",
    status: "83D",
    progress: 100,
    accent: "#6d7d4e",
  },
  {
    id: "cycling",
    label: "Ride — 1.4 km logged this week.",
    glyph: "cycling",
    value: 1,
    target: null,
    note: "1.4 KM",
    status: "LOGGED",
    progress: 22,
    accent: "#a8702c",
  },
];

export const GALLERY_PLAN: WeeklyPlanSnapshot = {
  label: "COACH DRAFT",
  isPreview: true,
  bandLow: GALLERY_ENGINE.bandLow,
  bandHigh: GALLERY_ENGINE.bandHigh,
  days: [
    { key: "mon", day: "Monday", dayShort: "MON", glyph: "badminton", sport: "badminton", title: "Badminton · Hit & Run", loadDelta: 210, href: "#" },
    { key: "tue", day: "Tuesday", dayShort: "TUE", glyph: "calisthenics", sport: "calisthenics", title: "Calisthenics · FL block", loadDelta: 90, href: "#" },
    { key: "wed", day: "Wednesday", dayShort: "WED", glyph: "calisthenics", sport: "calisthenics", title: "Calisthenics · HS block", loadDelta: 90, href: "#" },
    { key: "thu", day: "Thursday", dayShort: "THU", glyph: "badminton", sport: "badminton", title: "Badminton · Club night", loadDelta: 210, href: "#" },
    { key: "fri", day: "Friday", dayShort: "FRI", glyph: null, sport: "recovery", title: "Rest", loadDelta: null },
    { key: "sat", day: "Saturday", dayShort: "SAT", glyph: null, sport: "recovery", title: "Rest", loadDelta: null },
    { key: "sun", day: "Sunday", dayShort: "SUN", glyph: "cycling", sport: "cycling", title: "Ride · easy loop", loadDelta: 40, href: "#" },
  ],
};

export const GALLERY_SESSIONS: RecentSessionSnapshot[] = [
  { id: "s1", dateLabel: "JUL 16", title: "Hit & Run #35", detail: "1H55 · 130 BPM", load: 412, sport: "badminton", href: "#" },
  { id: "s2", dateLabel: "JUL 02", title: "Hit & Run #34", detail: "1H48 · 128 BPM", load: 498, sport: "badminton", href: "#" },
  { id: "s3", dateLabel: "JUL 01", title: "Calisthenics #31", detail: "52M · FL + HS", load: 96, sport: "calisthenics", href: "#" },
];

const MONTH_PATTERN = [
  "badminton", "empty", "foundation", "empty", "badminton", "empty", "empty",
  "empty", "calisthenics", "foundation", "empty", "badminton", "empty", "empty",
  "foundation", "empty", "calisthenics", "empty", "badminton", "cycling", "empty",
  "empty", "foundation", "badminton", "empty", "empty", "badminton", "empty",
] as const;

function galleryMonth(label: string, offset: number) {
  return {
    label,
    cells: MONTH_PATTERN.map((_, index) => MONTH_PATTERN[(index + offset) % MONTH_PATTERN.length]),
  };
}

export const GALLERY_TRAINING_ACTIVITY: TrainingActivitySnapshot = {
  rangeLabel: "FEB–JUL",
  months: [
    galleryMonth("FEB", 0),
    galleryMonth("MAR", 6),
    galleryMonth("APR", 12),
    galleryMonth("MAY", 18),
    galleryMonth("JUN", 24),
    galleryMonth("JUL", 30),
  ],
  longestBlock: 6,
  activeDays: 52,
  planTruePercent: 78,
  gapCount: 4,
  worstGap: 5,
  read: "Gaps follow big match days — that's the plan working, not slipping.",
};

export const GALLERY_CALORIES: CaloriesSnapshot = {
  monthLabel: "JUL",
  current: 5300,
  target: 12000,
  daysLeft: 12,
  daysInMonth: 31,
  pacePercent: 61,
  dailyActual: [
    180, 240, 310, 260, 300, 190, 220, 280, 340, 260,
    300, 250, 210, 290, 330, 260, 280, 300, 320,
  ],
  dailyNeeded: 558,
};

export const GALLERY_QUEST: QuestSnapshot = {
  name: "Weekly structured sessions",
  completed: 0,
  target: 2.5,
  loaded: 0,
  daysLeft: 4,
  sideQuests: [
    { name: "Mental visualization", value: 2, target: 5, color: "#7c6f9e" },
    { name: "Inner Game of Tennis", value: 3, target: 8, color: "#a8702c" },
  ],
};

export const GALLERY_VO2: Vo2Snapshot = {
  status: "available",
  value: 46.2,
  delta: 2.1,
  percentileLabel: "TOP 15% · AGE 30–39",
  trend: [
    { label: "JUL '25", value: 44.1 },
    { label: "AUG '25", value: 44.0 },
    { label: "SEP '25", value: 43.8 },
    { label: "OCT '25", value: 44.6 },
    { label: "NOV '25", value: 44.8 },
    { label: "DEC '25", value: 45.3 },
    { label: "MAY '26", value: 45.7 },
    { label: "JUL '26", value: 46.2 },
  ],
  read: "The boring easy volume is doing its job.",
};

export const GALLERY_VO2_EMPTY: Vo2Snapshot = {
  status: "unavailable",
  value: null,
  delta: null,
  trend: [],
  read: "No Apple Health VO₂ observations yet.",
};

export const GALLERY_COACH_READ: CoachReadSnapshot = {
  dateLabel: "JUL 23",
  body: "Load's sitting right in the band and the bar's gone quiet — that's the one to close this week, not the mileage. Hit & Run carried the week again; give calisthenics one honest session before Sunday and the whole picture holds.",
  signature: "— PHELPS",
};

export const GALLERY_PHASE: BuildPhaseSnapshot = {
  weekLabel: "WK 30",
  milestones: [
    {
      id: "front-lever",
      name: "Front lever",
      baseline: "8S",
      current: "9S",
      target: "FULL 5S",
      progressPercent: 60,
      projectedDateLabel: "SEP 6",
      note: "TRACKED ON THE LIMITING SIDE",
    },
    {
      id: "handstand",
      name: "Freestanding handstand",
      baseline: "6S",
      current: "5S",
      target: "15S",
      progressPercent: 30,
      projectedDateLabel: "AUG 16",
    },
    {
      id: "weighted-dips",
      name: "Weighted dips",
      baseline: "BW × 12",
      current: "BW × 12",
      target: "+10KG × 5",
      progressPercent: null,
      projectedDateLabel: "SEP 20",
    },
  ],
  read: "Dates assume 4 plan-true weeks — every missed bar day slides them right.",
};
