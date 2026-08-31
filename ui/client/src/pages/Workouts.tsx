import { CSSProperties, useMemo } from "react";
import { Link } from "wouter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import type { Activity } from "@/lib/activities";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import { SessionRow } from "@/components/home-warm/atoms/SessionRow";
import { formatMinutesLabel } from "@/components/home-warm/formatUtils";
import type { RecentSessionSnapshot, WarmSportId } from "@/components/home-warm/snapshots";
import { Workout, WorkoutType, WorkoutsData, countExercises, countSets } from "@/lib/workouts";
import { selectWorkoutsPage, type TodayHero, type WeekDay } from "@/lib/workoutPage";
import {
  SportBadge,
  accentFor,
  deriveBlockTags,
} from "@/components/workout-timer-warm/WorkoutTimerWidgets";
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

function weekRowSnapshot(day: WeekDay): RecentSessionSnapshot {
  return {
    id: day.date,
    dateLabel: weekDateLabel(day.date),
    title: day.title ?? "",
    detail: day.durationMin != null ? formatMinutesLabel(day.durationMin) : "",
    load: null,
    sport: asSport(day.sport),
  };
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

function TodayBand({ hero }: { hero: TodayHero }) {
  if (hero.kind === "runnable") {
    return (
      <div className="wi-workouts-hero">
        <WorkoutCard workout={hero.workout} badge={hero.done ? "done" : "today"} />
      </div>
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
    return <p className="wi-workouts-hero__line">Rest</p>;
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

  return (
    <div className="wi-shell">
      <div className="wi-board" style={{ maxWidth: 1180 }}>
        <InstrumentHeader
          currentRoute="/workouts"
          mobilePhaseLabel="WORKOUTS"
          phaseLabel="WORKOUTS"
          syncHealthy={syncStatusData.status === "success" || syncStatusData.status === "none"}
          syncLabel={syncStatusData.status}
          workoutsHref="/workouts"
        />
        <section className="wi-workouts-band">
          <div className="wi-workouts-band__label">Today</div>
          <TodayBand hero={page.today} />
        </section>
        {page.week ? (
          <section className="wi-workouts-band">
            <div className="wi-workouts-band__label">This week</div>
            <div className="wi-workouts-week">
              {page.week.map((day) => (
                <div
                  key={day.date}
                  className={day.source === "empty" ? "wi-workouts-week__empty" : undefined}
                >
                  <SessionRow session={weekRowSnapshot(day)} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className="wi-workouts-band">
          <div className="wi-workouts-band__label">Library</div>
          <div className="wtx-list-groups">
            {groups.map((group) => (
              <div key={group.type}>
                <div className="wtx-list-group__label">
                  {TYPE_LABEL[group.type] ?? group.type.toUpperCase()}
                </div>
                <div className="wtx-list-grid">
                  {group.cards.map((card) => (
                    <WorkoutCard key={card.workout.id} workout={card.workout} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
