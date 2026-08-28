import { useMemo, useState } from "react";
import { Redirect } from "wouter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import type { Activity } from "@/lib/activities";
import type { SplitLedger } from "@/lib/challenge";
import { isBadmintonAnalyticsAvailable } from "@/lib/plugins";
import { parseCurrentWeek } from "@/lib/currentWeek";
import { adaptCurrentWeek } from "@/components/home-warm/currentWeekAdapter";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import "@/components/home-warm/warm-instrument.css";
import "@/components/sport-analytics/sport-analytics.css";
import {
  buildBadmintonLensModel,
  type BadmintonMode,
} from "@/components/sport-analytics/badmintonLensModel";
import {
  AmIImprovingCard,
  BadmintonLensHeader,
  BestMonthCard,
  EffortCard,
  HeadToHeadCard,
  SessionShapeCard,
  WinRateHero,
} from "@/components/sport-analytics/BadmintonLensWidgets";
import { SportSpine } from "@/components/sport-analytics/SportSpine";

export default function SportAnalyticsBadminton() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported}>
      {data && <SportAnalyticsBadmintonContent data={data} />}
    </RepoDataGate>
  );
}

function SportAnalyticsBadmintonContent({ data }: { data: RepoData }) {
  const activities = data.activities as Activity[];
  const ledger = data.ledger as SplitLedger;
  const syncStatusData = data.sync_status as SyncStatusPayload;

  const currentWeekRt = parseCurrentWeek(data.current_week);
  const currentWeek =
    currentWeekRt.availability.available && currentWeekRt.data
      ? adaptCurrentWeek(currentWeekRt.data, currentWeekRt.availability, activities)
      : undefined;

  const [mode, setMode] = useState<BadmintonMode>("all");

  const lens = useMemo(() => buildBadmintonLensModel(activities, mode), [activities, mode]);

  if (!isBadmintonAnalyticsAvailable(data)) {
    return <Redirect to="/404" />;
  }

  return (
    <div className="wi-shell">
      <div className="wi-board">
        <InstrumentHeader
          phaseLabel="SPORT ANALYTICS · BADMINTON"
          mobilePhaseLabel="BADMINTON"
          syncHealthy={syncStatusData.status === "success" || syncStatusData.status === "none"}
          syncLabel={syncStatusData.status}
          workoutsHref="/workouts"
          currentRoute="/analytics/badminton"
        />

        <main className="sa-lens">
          <BadmintonLensHeader header={lens.header} mode={mode} onModeChange={setMode} />

          <WinRateHero winRate={lens.winRate} />

          {/* Session Shape, Best Month and Effort are web-only context widgets —
              the phone lens stays glance-only: hero, head-to-head, improving. */}
          <div className="sa-row sa-row--session-shape wi-desktop-only">
            <SessionShapeCard shape={lens.sessionShape} />
            <BestMonthCard bestMonth={lens.bestMonth} />
          </div>

          <div className="sa-row sa-row--h2h">
            <HeadToHeadCard headToHead={lens.headToHead} />
            <AmIImprovingCard improving={lens.amIImproving} />
          </div>

          <div className="sa-row sa-row--effort wi-desktop-only">
            <EffortCard effort={lens.effort} />
          </div>

          <SportSpine
            sport="badminton"
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
