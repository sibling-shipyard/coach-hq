import { CSSProperties, useMemo } from "react";
import { Link } from "wouter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import type { Activity } from "@/lib/activities";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import { formatMinutesLabel } from "@/components/home-warm/formatUtils";
import type { WarmSportId } from "@/components/home-warm/snapshots";
import { Workout, WorkoutType, WorkoutsData, countExercises, countSets } from "@/lib/workouts";
import { selectWorkoutsPage, type TodayHero, type WeekDay } from "@/lib/workoutPage";
import { SportBadge, accentFor, deriveBlockTags } from "@/components/workout-timer-warm/WorkoutTimerWidgets";
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

/** Same receipt row as Home SessionRow — no load column on Workouts. */
function WorkoutWeekRow({ day, todayInHero }: { day: WeekDay; todayInHero: boolean }) {
  const empty = day.source === "empty";
  const sport = asSport(day.sport);
  const detail = weekRowDetail(day);
  const rowClass = [
    "wi-session-row",
    "wi-workouts-week-row",
    day.isToday ? "is-today" : "",
    day.planStatus === "done" ? "is-done" : "",
    empty ? "is-empty" : "",
    day.isToday && todayInHero ? "is-in-hero" : "",
    day.timing === "past" && day.planStatus === "planned" ? "is-past" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClass}>
      <span className="wi-session-row__date">{weekDateLabel(day.date)}</span>
      <span className={`wi-session-row__vein is-${sport}`} aria-hidden />
      <strong>{empty ? "—" : (day.title ?? "")}</strong>
      {detail ? <span className="wi-session-row__detail">{detail}</span> : null}
    </div>
  );
}

function WorkoutCard({ workout, badge }: { workout: Workout; badge?: "today" | "done" }) {
  const accent = accentFor(workout.workout_type);
  const { tags, overflow } = deriveBlockTags(workout);

  return (
    <Link
      href={`/workouts/${workout.id}`}
      className="wtx-list-card"
      style={{ "--card-accent": accent } as CSSProperties}
    >
      <div className="wtx-list-card__top">
        <div className="wtx-list-card__top-left">
          <SportBadge
            label={TYPE_LABEL[workout.workout_type] ?? workout.workout_type.toUpperCase()}
            accent={accent}
          />
          {badge ? (
            <span className="wtx-list-card__today">{badge === "done" ? "DONE" : "TODAY"}</span>
          ) : null}
        </div>
        <span className="wtx-list-card__arrow">→</span>
      </div>
      <div>
        <div className="wtx-list-card__title">{workout.title}</div>
        <div className="wtx-list-card__subtitle">{workout.subtitle}</div>
      </div>
      {workout.coaching_note ? (
        <p className="wtx-list-card__note" style={{ "--card-accent": accent } as CSSProperties}>
          {workout.coaching_note}
        </p>
      ) : null}
      <div className="wtx-list-card__stats">
        <span>{workout.estimated_duration_mins}M</span>
        <span>{countExercises(workout)} EXERCISES</span>
        <span>{countSets(workout)} SETS</span>
        <span>{workout.location.toUpperCase()}</span>
      </div>
      {tags.length ? (
        <div className="wtx-list-card__tags">
          {tags.map((tag) => (
            <span className="wtx-list-card__tag" key={tag}>
              {tag.toUpperCase()}
            </span>
          ))}
          {overflow > 0 ? <span className="wtx-list-card__tag">+{overflow}</span> : null}
        </div>
      ) : null}
    </Link>
  );
}

function LibraryCard({ workout }: { workout: Workout }) {
  const accent = accentFor(workout.workout_type);
  return (
    <Link
      href={`/workouts/${workout.id}`}
      className="wtx-list-card wtx-list-card--compact"
      style={{ "--card-accent": accent } as CSSProperties}
    >
      <div className="wtx-list-card__top">
        <SportBadge
          label={TYPE_LABEL[workout.workout_type] ?? workout.workout_type.toUpperCase()}
          accent={accent}
        />
        <span className="wtx-list-card__arrow">→</span>
      </div>
      <div className="wtx-list-card__title">{workout.title}</div>
      <div className="wtx-list-card__subtitle">{workout.subtitle}</div>
      <div className="wtx-list-card__stats">
        <span>{workout.estimated_duration_mins}M</span>
        <span>{workout.location}</span>
      </div>
    </Link>
  );
}

function TodayBand({ hero }: { hero: TodayHero }) {
  if (hero.kind === "runnable") {
    return <WorkoutCard workout={hero.workout} badge={hero.done ? "done" : "today"} />;
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
  return <p className="wi-workouts-hero__line">No plan this week.</p>;
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

  const todayInHero = page.today.kind === "runnable";

  return (
    <div className="wi-shell">
      <div className="wi-board wi-workouts-board">
        <InstrumentHeader
          currentRoute="/workouts"
          mobilePhaseLabel="WORKOUTS"
          phaseLabel="WORKOUTS"
          syncHealthy={syncStatusData.status === "success" || syncStatusData.status === "none"}
          syncLabel={syncStatusData.status}
          workoutsHref="/workouts"
        />

        <div className="wi-workouts-page">
          <section className="wi-workouts-today">
            <div className="wi-card-kicker">
              <span>TODAY</span>
            </div>
            <TodayBand hero={page.today} />
          </section>

          {page.week ? (
            <section className="wi-sessions-card wi-workouts-week-card">
              <div className="wi-card-kicker">
                <span>THIS WEEK</span>
              </div>
              <div className="wi-sessions-card__rows">
                {page.week.map((day) => (
                  <WorkoutWeekRow key={day.date} day={day} todayInHero={todayInHero} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="wi-workouts-library">
            <div className="wi-card-kicker">
              <span>LIBRARY</span>
            </div>
            <div className="wtx-list-groups">
              {groups.map((group) => (
                <div key={group.type}>
                  <div className="wtx-list-group__label">
                    {TYPE_LABEL[group.type] ?? group.type.toUpperCase()}
                  </div>
                  <div className="wtx-list-grid">
                    {group.cards.map((card) => (
                      <LibraryCard key={card.workout.id} workout={card.workout} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
