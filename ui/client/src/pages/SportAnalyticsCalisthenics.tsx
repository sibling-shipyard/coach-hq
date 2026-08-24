import { useMemo } from "react";
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
import { buildCalisthenicsLensModel } from "@/components/sport-analytics/calisthenicsLensModel";
import {
  CalisthenicsCoachReadCard,
  CalisthenicsImprovingCard,
  CalisthenicsLensHeader,
  ConsistencyCard,
  SkillTracksCard,
  TestedE1rmCard,
} from "@/components/sport-analytics/CalisthenicsLensWidgets";
import { SportSpine } from "@/components/sport-analytics/SportSpine";

export default function SportAnalyticsCalisthenics() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported}>
      {data && <SportAnalyticsCalisthenicsContent data={data} />}
    </RepoDataGate>
  );
}

function SportAnalyticsCalisthenicsContent({ data }: { data: RepoData }) {
  const activities = data.activities as Activity[];
  const ledger = data.ledger as SplitLedger;
  const syncStatusData = data.sync_status as SyncStatusPayload;

  const currentWeekRt = parseCurrentWeek(data.current_week);
  const currentWeek =
    currentWeekRt.availability.available && currentWeekRt.data
      ? adaptCurrentWeek(currentWeekRt.data, currentWeekRt.availability, activities)
      : undefined;

  const lens = useMemo(
    () => buildCalisthenicsLensModel(activities, ledger),
    [activities, ledger],
  );

  return (
    <div className="wi-shell">
      <div className="wi-board">
        <InstrumentHeader
          phaseLabel="SPORT ANALYTICS · CALISTHENICS"
          mobilePhaseLabel="CALISTHENICS"
          syncHealthy={syncStatusData.status === "success" || syncStatusData.status === "none"}
          syncLabel={syncStatusData.status}
          workoutsHref="/workouts"
          currentRoute="/analytics/calisthenics"
        />

        <main className="sa-lens">
          <CalisthenicsLensHeader header={lens.header} />

          <SkillTracksCard skillTracks={lens.skillTracks} />

          <div className="sa-row sa-row--calisthenics-lens">
            <div className="sa-calisthenics-lens__left">
              <CalisthenicsImprovingCard improving={lens.improving} />
              <TestedE1rmCard tested={lens.testedE1rm} />
            </div>
            <div className="sa-calisthenics-lens__right">
              <ConsistencyCard consistency={lens.consistency} />
              <div className="wi-desktop-only">
                <CalisthenicsCoachReadCard coachRead={lens.coachRead} />
              </div>
            </div>
          </div>

          <SportSpine
            sport="calisthenics"
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
