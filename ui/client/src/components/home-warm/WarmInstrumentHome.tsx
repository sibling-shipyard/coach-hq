import { useMemo } from "react";
import type { SplitLedger } from "@/lib/challenge";
import type { Activity } from "@/lib/activities";
import type { CurrentWeekContract } from "./currentWeek.fixture";
import { GOLDEN_CURRENT_WEEK } from "@/lib/goldenDataset";
import { buildLiveWeekContract } from "./liveWeekContract";
import type { SyncStatusPayload } from "./warmHomeModel";
import { buildWarmHomeModel } from "./warmHomeModel";
import { buildWarmHomeSnapshots } from "./warmHomeSnapshots";
import {
  BuildPhaseCard,
  CaloriesCard,
  CoachMessageCard,
  CoachReadCard,
  DesktopHomeGrid,
  EngineCard,
  InstrumentHeader,
  QuestCard,
  RecentSessionsCard,
  SportCommitmentCard,
  TrainingActivityCard,
  Vo2Card,
  WeeklyPlanCard,
} from "./WarmInstrumentWidgets";
import type { CoachMessageSnapshot } from "./snapshots";
import "./warm-instrument.css";

interface WarmInstrumentHomeProps {
  activities: Activity[];
  ledger: SplitLedger;
  syncStatus: SyncStatusPayload;
  currentWeek?: CurrentWeekContract;
  dataMode?: "reference" | "live";
  coachMessage?: CoachMessageSnapshot;
}

export {
  buildActivityEvidenceSnapshots,
  buildCommitmentSnapshots,
  buildEngineSnapshot,
  buildRecentSessions,
  buildTrainingActivitySnapshot,
  buildWarmHomeSnapshots,
  buildWidgetSnapshotsFile,
} from "./warmHomeSnapshots";

export function WarmInstrumentHome({
  activities,
  ledger,
  syncStatus,
  currentWeek,
  dataMode = "reference",
  coachMessage,
}: WarmInstrumentHomeProps) {
  const snapshots = useMemo(() => {
    const effectiveWeek = currentWeek ?? (dataMode === "live"
      ? buildLiveWeekContract(activities)
      : GOLDEN_CURRENT_WEEK);
    return buildWarmHomeSnapshots(
      activities,
      ledger,
      syncStatus,
      effectiveWeek,
      dataMode,
    );
  }, [activities, ledger, currentWeek, dataMode, syncStatus]);

  const model = useMemo(() => {
    const effectiveWeek = currentWeek ?? (dataMode === "live"
      ? buildLiveWeekContract(activities)
      : GOLDEN_CURRENT_WEEK);
    return buildWarmHomeModel(activities, ledger, syncStatus, effectiveWeek);
  }, [activities, ledger, currentWeek, dataMode, syncStatus]);

  return (
      <div className={`wi-shell ${dataMode === "live" ? "is-live-data" : ""}`.trim()}>
        <div className="wi-board">
        <InstrumentHeader
          phaseLabel={dataMode === "live" ? `LIVE DATA · ${snapshots.phase.weekLabel}` : snapshots.phase.weekLabel}
          mobilePhaseLabel={dataMode === "live" ? `LIVE · ${snapshots.phase.weekLabel}` : `BUILD · ${snapshots.phase.weekLabel}`}
          syncHealthy={snapshots.sync.healthy}
          syncLabel={snapshots.sync.label}
          workoutsHref="/workouts"
          currentRoute="/"
        />
        {!snapshots.sync.healthy ? (
          <div className="wi-sync-warning" role="status">
            Training data may be incomplete. Check the latest sync before acting on the signal.
          </div>
        ) : null}

        {coachMessage ? <CoachMessageCard message={coachMessage} /> : null}

        <DesktopHomeGrid>
          <div className="wi-hero-row">
            <EngineCard engine={snapshots.engine} />
            <aside className="wi-right-rail" aria-label="Quest and coach summary">
              <QuestCard quest={snapshots.quest} />
              <CoachReadCard read={snapshots.coachRead} />
            </aside>
          </div>

          <section className="wi-commitment-grid" aria-label="Weekly sport commitments">
            {snapshots.commitments.map((item) => (
              <SportCommitmentCard item={item} key={item.id} />
            ))}
          </section>

          <div className="wi-split-row">
            <WeeklyPlanCard plan={snapshots.plan} />
            <div className="wi-desktop-only">
              <CaloriesCard calories={snapshots.calories} />
            </div>
          </div>

          <div className="wi-mobile-pair wi-mobile-only">
            <CaloriesCard calories={snapshots.calories} />
            <QuestCard compact quest={snapshots.quest} />
          </div>

          <div className="wi-split-row wi-evidence-row">
            <TrainingActivityCard activity={snapshots.trainingActivity} />
            <Vo2Card vo2={snapshots.vo2} />
          </div>

          <div className="wi-split-row wi-closing-row wi-desktop-only">
            <RecentSessionsCard sessions={snapshots.sessions} />
            <BuildPhaseCard phase={snapshots.phase} />
          </div>

          <div className="wi-mobile-stack wi-mobile-only">
            <BuildPhaseCard phase={snapshots.phase} />
            <RecentSessionsCard sessions={snapshots.sessions} />
          </div>
          </DesktopHomeGrid>
        </div>
      </div>
  );
}
