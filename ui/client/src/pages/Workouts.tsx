import { CSSProperties, useMemo } from "react";
import { Link } from "wouter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import { toLocalDateStr } from "@/lib/challenge";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import {
  Workout,
  WorkoutType,
  WorkoutsData,
  countExercises,
  countSets,
} from "@/lib/workouts";
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

function WorkoutCard({ workout, hasSession }: { workout: Workout; hasSession: boolean }) {
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
          <SportBadge label={TYPE_LABEL[workout.workout_type] ?? workout.workout_type.toUpperCase()} accent={accent} />
          {hasSession ? <span className="wtx-list-card__today">TODAY</span> : null}
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

  const groups = useMemo(() => {
    const today = toLocalDateStr(new Date());
    const templateIds = new Set(workoutsData.templates.map((t) => t.id));
    const templateCards = workoutsData.templates.map((template) => {
      const todaySession = workoutsData.sessions.find(
        (s) => s.id === template.id && s.session_date === today,
      );
      return { workout: todaySession ?? template, hasSession: !!todaySession };
    });
    // A one-off session for a workout type with no matching template (Coach gives a cali
    // session to an athlete with no cali template) has no template card to piggyback on above.
    const standaloneCards = workoutsData.sessions
      .filter((s) => s.session_date === today && !templateIds.has(s.id))
      .map((session) => ({ workout: session, hasSession: true }));
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

  const hasTodaySession = groups.some((group) => group.cards.some((card) => card.hasSession));

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
        {hasTodaySession ? (
          <div className="wtx-list-banner">
            <div className="wtx-list-banner__title">Coach has customized workouts for today</div>
            <div className="wtx-list-banner__body">
              Session-specific modifications are applied. Look for the TODAY badge.
            </div>
          </div>
        ) : null}
        <div className="wtx-list-groups">
          {groups.map((group) => (
            <div key={group.type}>
              <div className="wtx-list-group__label">{TYPE_LABEL[group.type] ?? group.type.toUpperCase()}</div>
              <div className="wtx-list-grid">
                {group.cards.map((card) => (
                  <WorkoutCard key={card.workout.id} workout={card.workout} hasSession={card.hasSession} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
