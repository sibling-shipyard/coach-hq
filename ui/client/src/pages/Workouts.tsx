import { CSSProperties, useMemo, useState } from "react";
import { Link } from "wouter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import type { Activity } from "@/lib/activities";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import { formatMinutesLabel } from "@/components/home-warm/formatUtils";
import type { WarmSportId } from "@/components/home-warm/snapshots";
import { Workout, WorkoutType, WorkoutsData } from "@/lib/workouts";
import {
  resolveDayHero,
  selectWorkoutsPage,
  type TodayHero,
  type WeekDay,
} from "@/lib/workoutPage";
import { SportBadge, accentFor } from "@/components/workout-timer-warm/WorkoutTimerWidgets";
import "@/components/home-warm/warm-instrument.css";

const TYPE_ORDER: WorkoutType[] = ["foundation", "strength", "calisthenics", "recovery", "realign"];
const TYPE_LABEL: Record<WorkoutType, string> = {
  foundation: "FOUNDATION",
  strength: "STRENGTH",
  calisthenics: "CALISTHENICS",
  recovery: "RECOVERY",
  realign: "REALIGN",
};

const WARM_SPORTS: readonly WarmSportId[] = [
  "cycling",
  "badminton",
  "calisthenics",
  "foundation",
  "run",
  "other",
  "strength",
  "weight_training",
  "hike",
  "walk",
  "cricket",
  "football",
  "workout",
  "swim",
];

function isManifestId(id: string): boolean {
  return id === "_manifest" || id.endsWith("_manifest");
}

function asSport(value: string | null | undefined): WarmSportId {
  if (!value) return "other";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if ((WARM_SPORTS as readonly string[]).includes(normalized)) return normalized as WarmSportId;
  if (normalized.includes("badminton")) return "badminton";
  if (normalized.includes("calisthenic")) return "calisthenics";
  if (normalized === "ride" || normalized === "bike") return "cycling";
  if (normalized === "running") return "run";
  if (normalized === "weights" || normalized === "weighttraining") return "weight_training";
  if (normalized === "hiking") return "hike";
  if (normalized === "walking") return "walk";
  if (normalized === "soccer") return "football";
  if (normalized === "swimming") return "swim";
  if (normalized === "recovery" || normalized === "realign" || normalized === "mobility") {
    return "foundation";
  }
  return "other";
}

function weekDateLabel(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })
    .toUpperCase();
  const day = date.slice(8, 10).replace(/^0/, "");
  return `${weekday} ${day}`;
}

function weekRowDetail(day: WeekDay): string {
  const duration = day.durationMin != null ? formatMinutesLabel(day.durationMin) : "";
  if (day.planStatus === "done") return duration ? `Done · ${duration}` : "Done";
  if (day.planStatus === "skipped") return "Skipped";
  if (day.source === "activity") return duration || "Logged";
  return duration;
}

function WorkoutWeekRow({ day, workouts }: { day: WeekDay; workouts: WorkoutsData }) {
  const empty = day.source === "empty";
  const sport = asSport(day.sport);
  const detail = weekRowDetail(day);
  const hero = resolveDayHero(day, workouts);
  const href = hero.kind === "runnable" ? `/workouts/${hero.workout.id}` : null;
  const rowClass = [
    "wi-session-row",
    "wi-workouts-week-row",
    day.isToday ? "is-today" : "",
    day.planStatus === "done" ? "is-done" : "",
    empty ? "is-empty" : "",
    href ? "is-link" : "",
    day.timing === "past" && day.planStatus === "planned" ? "is-past" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <span className={`wi-session-row__date${day.isToday ? " is-today-date" : ""}`}>
        {weekDateLabel(day.date)}
      </span>
      <span className={`wi-session-row__vein is-${sport}`} aria-hidden />
      <strong>{empty ? "—" : (day.title ?? "")}</strong>
      {detail ? <span className="wi-session-row__detail">{detail}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={rowClass}
        aria-current={day.isToday ? "date" : undefined}
      >
        {body}
      </Link>
    );
  }

  return (
    <div className={rowClass} aria-current={day.isToday ? "date" : undefined}>
      {body}
    </div>
  );
}

function TodayRail({ hero }: { hero: TodayHero }) {
  if (hero.kind === "runnable") {
    const workout = hero.workout;
    const accent = accentFor(workout.workout_type);
    return (
      <aside className="wi-workouts-today-rail">
        <div className="wi-card-kicker">
          <span>{hero.done ? "DONE TODAY" : "TODAY"}</span>
        </div>
        <Link
          href={`/workouts/${workout.id}`}
          className="wi-workouts-today-card"
          style={{ "--card-accent": accent } as CSSProperties}
        >
          <div className="wi-workouts-today-card__top">
            <SportBadge
              label={TYPE_LABEL[workout.workout_type] ?? workout.workout_type.toUpperCase()}
              accent={accent}
            />
            <span className="wi-workouts-today-card__arrow">→</span>
          </div>
          <strong>{workout.title}</strong>
          {workout.subtitle ? <span className="wi-workouts-today-card__sub">{workout.subtitle}</span> : null}
          {workout.coaching_note ? (
            <em className="wi-workouts-today-card__note">{workout.coaching_note}</em>
          ) : null}
          <div className="wi-workouts-today-card__meta">
            <span>{workout.estimated_duration_mins}M</span>
            <span>{workout.location.toUpperCase()}</span>
          </div>
        </Link>
      </aside>
    );
  }

  if (hero.kind === "mention") {
    return (
      <aside className="wi-workouts-today-rail">
        <div className="wi-card-kicker">
          <span>TODAY</span>
        </div>
        <p className="wi-workouts-hero__line">
          {hero.title}
          {hero.durationMin != null ? <span>{hero.durationMin} min</span> : null}
        </p>
      </aside>
    );
  }

  if (hero.kind === "rest") {
    return (
      <aside className="wi-workouts-today-rail">
        <div className="wi-card-kicker">
          <span>TODAY</span>
        </div>
        <p className="wi-workouts-hero__line">Rest day — nothing scheduled.</p>
      </aside>
    );
  }

  return null;
}

function RoutineRow({ workout }: { workout: Workout }) {
  const sport = asSport(workout.workout_type);
  return (
    <Link href={`/workouts/${workout.id}`} className="wi-workouts-lib-row">
      <span className={`wi-workouts-lib-row__vein is-${sport}`} aria-hidden />
      <span className="wi-workouts-lib-row__title">{workout.title}</span>
      <span className="wi-workouts-lib-row__meta">
        {workout.estimated_duration_mins}m · {workout.location}
      </span>
    </Link>
  );
}

function AllRoutines({
  groups,
}: {
  groups: Array<{ type: WorkoutType; cards: Array<{ workout: Workout }> }>;
}) {
  const [open, setOpen] = useState(false);
  const count = groups.reduce((sum, group) => sum + group.cards.length, 0);

  return (
    <section className="wi-workouts-routines">
      <button
        type="button"
        className="wi-workouts-routines__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="wi-card-kicker">
          <span>ALL ROUTINES</span>
        </span>
        <span className="wi-workouts-routines__hint">
          {count} · {open ? "Hide" : "Show"}
        </span>
      </button>
      {open ? (
        <div className="wi-workouts-routines__list">
          {groups.map((group) => (
            <div key={group.type} className="wi-workouts-library__group">
              <div className="wi-workouts-library__group-label">
                {TYPE_LABEL[group.type] ?? group.type.toUpperCase()}
              </div>
              {group.cards.map((card) => (
                <RoutineRow key={card.workout.id} workout={card.workout} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default function Workouts() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported}>
      {data && <WorkoutsContent data={data} />}
    </RepoDataGate>
  );
}

function WorkoutsContent({ data }: { data: RepoData }) {
  const workoutsData = data.workouts as WorkoutsData;
  const syncStatusData = data.sync_status as SyncStatusPayload;
  const athleteTimezone =
    typeof data.profile?.timezone === "string" ? data.profile.timezone : undefined;

  const page = useMemo(() => {
    const activities = (Array.isArray(data.activities) ? data.activities : []) as Activity[];
    return selectWorkoutsPage(
      workoutsData,
      data.current_week,
      activities.map((activity) => ({
        start: activity.start_date_local,
        sport: activity.sport_type,
        title: activity.name,
      })),
      athleteTimezone,
    );
  }, [athleteTimezone, data.activities, data.current_week, workoutsData]);

  const groups = useMemo(() => {
    const templates = (workoutsData.templates ?? []).filter((t) => t.id && !isManifestId(t.id));
    const templateIds = new Set(templates.map((t) => t.id));
    const templateCards = templates.map((template) => ({ workout: template }));
    const standaloneCards = (workoutsData.sessions ?? [])
      .filter((s) => !templateIds.has(s.id) && !isManifestId(s.id))
      .map((session) => ({ workout: session }));
    const cards = [...templateCards, ...standaloneCards];
    const byType: Record<string, typeof cards> = {};
    cards.forEach((card) => {
      const type = card.workout.workout_type;
      (byType[type] ??= []).push(card);
    });
    const ordered = TYPE_ORDER.filter((type) => byType[type]?.length).map((type) => ({
      type,
      cards: byType[type],
    }));
    const leftover = Object.keys(byType)
      .filter((type) => !TYPE_ORDER.includes(type as WorkoutType))
      .map((type) => ({ type: type as WorkoutType, cards: byType[type] }));
    return [...ordered, ...leftover];
  }, [workoutsData]);

  const showTodayRail = page.today.kind !== "none";

  return (
    <div className="wi-shell">
      <div className="wi-board">
        <InstrumentHeader
          currentRoute="/workouts"
          mobilePhaseLabel="WORKOUTS"
          phaseLabel="WORKOUTS"
          syncHealthy={syncStatusData.status === "success" || syncStatusData.status === "none"}
          syncLabel={syncStatusData.status}
          workoutsHref="/workouts"
        />

        <div className="wi-workouts-page">
          <div className={`wi-workouts-split${showTodayRail ? "" : " is-week-only"}`}>
            {page.week ? (
              <section className="wi-sessions-card wi-workouts-week-card">
                <div className="wi-card-kicker">
                  <span>THIS WEEK</span>
                </div>
                <div className="wi-sessions-card__rows">
                  {page.week.map((day) => (
                    <WorkoutWeekRow key={day.date} day={day} workouts={workoutsData} />
                  ))}
                </div>
              </section>
            ) : (
              <section className="wi-workouts-week-card">
                <div className="wi-card-kicker">
                  <span>THIS WEEK</span>
                </div>
                <p className="wi-workouts-hero__line">No week plan yet.</p>
              </section>
            )}

            {showTodayRail ? <TodayRail hero={page.today} /> : null}
          </div>

          {groups.length ? <AllRoutines groups={groups} /> : null}
        </div>
      </div>
    </div>
  );
}
