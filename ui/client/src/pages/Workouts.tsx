import { CSSProperties, useMemo } from "react";
import { Link } from "wouter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import type { Activity } from "@/lib/activities";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import { formatMinutesLabel } from "@/components/home-warm/formatUtils";
import type { WarmSportId } from "@/components/home-warm/snapshots";
import { Workout, WorkoutType, WorkoutsData } from "@/lib/workouts";
import { selectWorkoutsPage, type TodayHero, type WeekDay } from "@/lib/workoutPage";
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

function planDayLabel(date: string): { short: string; num: string } {
  const short = new Date(`${date}T00:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })
    .toUpperCase()
    .slice(0, 3);
  const num = date.slice(8, 10).replace(/^0/, "");
  return { short, num };
}

function WorkoutPlanDay({ day }: { day: WeekDay }) {
  const empty = day.source === "empty";
  const sport = asSport(day.sport);
  const { short, num } = planDayLabel(day.date);
  const duration = day.durationMin != null ? formatMinutesLabel(day.durationMin) : null;
  const slotClass = [
    "wi-plan-day__slot",
    "wi-workouts-plan-slot",
    empty ? "is-empty" : `is-${sport}`,
    day.planStatus === "done" ? "is-done" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const dayClass = [
    "wi-plan-day",
    "wi-workouts-plan-day",
    day.isToday ? "is-today" : "",
    day.planStatus === "done" ? "is-done" : "",
    day.timing === "past" && day.planStatus === "planned" ? "is-past" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={dayClass} aria-current={day.isToday ? "date" : undefined}>
      <span className={`wi-plan-day__label${day.isToday ? " is-today-label" : ""}`}>
        <span className="wi-desktop-only">
          {short} {num}
        </span>
        <span className="wi-mobile-only">{short.slice(0, 1)}</span>
      </span>
      <div className={slotClass}>
        {empty ? (
          <span className="wi-workouts-plan-slot__empty">—</span>
        ) : (
          <>
            <span className="wi-workouts-plan-slot__title">{day.title}</span>
            {duration ? <small>{day.planStatus === "done" ? `Done · ${duration}` : duration}</small> : null}
          </>
        )}
      </div>
    </div>
  );
}

function LibraryRow({ workout }: { workout: Workout }) {
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

function TodayBand({ hero }: { hero: TodayHero }) {
  if (hero.kind === "runnable") {
    const workout = hero.workout;
    const accent = accentFor(workout.workout_type);
    return (
      <section className="wi-workouts-today">
        <div className="wi-card-kicker">
          <span>{hero.done ? "DONE TODAY" : "TODAY"}</span>
        </div>
        <Link
          href={`/workouts/${workout.id}`}
          className="wi-workouts-today-bar"
          style={{ "--card-accent": accent } as CSSProperties}
        >
          <SportBadge
            label={TYPE_LABEL[workout.workout_type] ?? workout.workout_type.toUpperCase()}
            accent={accent}
          />
          <div className="wi-workouts-today-bar__body">
            <strong>{workout.title}</strong>
            {workout.subtitle ? <span>{workout.subtitle}</span> : null}
            {workout.coaching_note ? <em>{workout.coaching_note}</em> : null}
          </div>
          <span className="wi-workouts-today-bar__cta">
            {workout.estimated_duration_mins}m · Start →
          </span>
        </Link>
      </section>
    );
  }
  if (hero.kind === "mention") {
    return (
      <p className="wi-workouts-hero__line">
        {hero.title}
        {hero.durationMin != null ? <span>{hero.durationMin} min</span> : null}
      </p>
    );
  }
  if (hero.kind === "rest") {
    return <p className="wi-workouts-hero__line">Rest day — nothing scheduled.</p>;
  }
  return null;
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
          {page.week ? (
            <section className="wi-plan-card wi-workouts-plan">
              <div className="wi-card-kicker">
                <span>THIS WEEK</span>
              </div>
              <div className="wi-plan-card__days" role="list">
                {page.week.map((day) => (
                  <WorkoutPlanDay key={day.date} day={day} />
                ))}
              </div>
            </section>
          ) : null}

          <TodayBand hero={page.today} />

          <section className="wi-workouts-library">
            <div className="wi-card-kicker">
              <span>LIBRARY</span>
            </div>
            <div className="wi-workouts-library__grid">
              {groups.map((group) => (
                <div key={group.type} className="wi-workouts-library__group">
                  <div className="wi-workouts-library__group-label">
                    {TYPE_LABEL[group.type] ?? group.type.toUpperCase()}
                  </div>
                  {group.cards.map((card) => (
                    <LibraryRow key={card.workout.id} workout={card.workout} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
