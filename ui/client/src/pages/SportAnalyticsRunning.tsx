import { useMemo, useState } from "react";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import type { Activity } from "@/lib/activities";
import type { SplitLedger } from "@/lib/challenge";
import { parseCurrentWeek } from "@/lib/currentWeek";
import { adaptCurrentWeek } from "@/components/home-warm/currentWeekAdapter";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import "@/components/home-warm/warm-instrument.css";
import "@/components/sport-analytics/sport-analytics.css";
import { EffortCard } from "@/components/sport-analytics/BadmintonLensWidgets";
import { buildRunningLensModel, type RunningScope } from "@/components/sport-analytics/runningLensModel";
import {
  BenchmarkCard,
  CoachReadCard,
  PaceTrendCard,
  PbsCard,
  RunningLensHeader,
  WeeklyVolumeHero,
} from "@/components/sport-analytics/RunningLensWidgets";
import { SportSpine } from "@/components/sport-analytics/SportSpine";

export default function SportAnalyticsRunning() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported}>
      {data && <SportAnalyticsRunningContent data={data} />}
    </RepoDataGate>
  );
}

function SportAnalyticsRunningContent({ data }: { data: RepoData }) {
  const activities = data.activities as Activity[];
  const ledger = data.ledger as SplitLedger;
  const syncStatusData = data.sync_status as SyncStatusPayload;

  const currentWeekRt = parseCurrentWeek(data.current_week);
  const currentWeek =
    currentWeekRt.availability.available && currentWeekRt.data
      ? adaptCurrentWeek(currentWeekRt.data, currentWeekRt.availability, activities)
      : undefined;

  const [volumeScope, setVolumeScope] = useState<RunningScope>("8w");

  const lens = useMemo(() => buildRunningLensModel(activities, volumeScope), [activities, volumeScope]);

  return (
    <div className="wi-shell">
      <div className="wi-board">
        <InstrumentHeader
          phaseLabel="SPORT ANALYTICS · RUNNING"
          mobilePhaseLabel="RUNNING"
          syncHealthy={syncStatusData.status === "success" || syncStatusData.status === "none"}
          syncLabel={syncStatusData.status}
          workoutsHref="/workouts"
          currentRoute="/analytics/running"
        />

        <main className="sa-lens">
          <RunningLensHeader header={lens.header} />

          <WeeklyVolumeHero
            volume={lens.weeklyVolume}
            scope={volumeScope}
            onScopeChange={setVolumeScope}
          />

          <div className="sa-row sa-row--running-benchmark">
            <BenchmarkCard benchmark={lens.benchmark} />
            <PbsCard pbs={lens.pbs} />
          </div>

          <div className="sa-row sa-row--running-trend">
            <PaceTrendCard paceTrend={lens.paceTrend} />
            <div className="sa-running-side">
              <CoachReadCard coachRead={lens.coachRead} />
              <div className="wi-desktop-only">
                <EffortCard effort={lens.effort} />
              </div>
            </div>
          </div>

          <SportSpine
            sport="run"
            activities={activities}
            ledger={ledger}
            syncStatus={syncStatusData}
            currentWeek={currentWeek}
          />
        </main>
      </div>
    </div>
  );
}
