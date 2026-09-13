import { CSSProperties, useMemo } from "react";
import { Link } from "wouter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import { parseCurrentWeek } from "@/lib/currentWeek";
import type { Activity } from "@/lib/activities";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import type { SessionDiscipline } from "@/components/home-warm/currentWeek.fixture";
import type { RecentSessionSnapshot, WarmSportId } from "@/components/home-warm/snapshots";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import { SessionRow } from "@/components/widgets/SessionRow";
import { formatMinutesInstrumentLabel } from "@/components/home-warm/formatUtils";
import {
  Workout,
  WorkoutType,
  WorkoutsData,
  countExercises,
  countSets,
  validTemplates,
  validSessions,
} from "@/lib/workouts";
import { selectWorkoutsPage, type TodayBand, type WeekRow } from "@/lib/workoutsPageSelector";
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

/** SessionDiscipline is a superset of WarmSportId — only "recovery" has no dedicated glyph. */
function asWarmSport(discipline: SessionDiscipline | null): WarmSportId {
  if (!discipline || discipline === "recovery") return "foundation";
  return discipline;
}

function weekDateLabel(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })
    .toUpperCase();
  const day = date.slice(8, 10).replace(/^0/, "");
  return `${weekday} ${day}`;
}

function weekRowSnapshot(row: WeekRow): RecentSessionSnapshot {
  return {
    id: row.date,
    dateLabel: weekDateLabel(row.date),
    title: row.title ?? "",
    detail: row.durationMin != null ? formatMinutesInstrumentLabel(row.durationMin) : "",
    load: null,
    sport: asWarmSport(row.discipline),
  };
}

function isManifestId(id: string): boolean {
  return id === "_manifest" || id.endsWith("_manifest");
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

/** The only band with a timer button. Never labeled "Rest" for a day that has real content. */
function TodayBandView({ hero }: { hero: TodayBand }) {
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
  return <p className="wi-workouts-hero__line">No live plan right now.</p>;
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
    return selectWorkoutsPage({
      workouts: workoutsData,
      currentWeek: parseCurrentWeek(data.current_week),
      activities,
      athleteTimezone,
    });
  }, [athleteTimezone, data.activities, data.current_week, workoutsData]);

  // Library band: every template plus any standalone session with no matching template,
  // grouped by workout_type. Today's plan lives in its own band above, not folded in here.
  const groups = useMemo(() => {
    const templates = validTemplates(workoutsData);
    const templateIds = new Set(templates.map((t) => t.id));
    const templateCards = templates.map((template) => ({ workout: template }));
    const standaloneCards = validSessions(workoutsData)
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
    // Any workout_type not in TYPE_ORDER (a future type — "rehab", etc. — the UI doesn't have
    // a dedicated slot for yet) still gets its own section instead of silently disappearing.
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
        <main>
          <section className="wi-workouts-band">
            <div className="wi-workouts-band__label">Today</div>
            <TodayBandView hero={page.today} />
          </section>
          {page.week ? (
            <section className="wi-workouts-band">
              <div className="wi-workouts-band__label">This week</div>
              <div className="wi-workouts-week">
                {page.week.map((row) => (
                  <div
                    key={row.date}
                    className={row.source === "empty" ? "wi-workouts-week__empty" : undefined}
                  >
                    <SessionRow session={weekRowSnapshot(row)} />
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
        </main>
      </div>
    </div>
  );
}
