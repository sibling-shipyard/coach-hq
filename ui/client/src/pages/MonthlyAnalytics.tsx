import { useMemo, useState } from "react";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import { buildWarmHomeModel, type SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { buildLiveWeekContract } from "@/components/home-warm/liveWeekContract";
import type { Activity } from "@/lib/activities";
import type { ChallengeV2 } from "@/lib/challenge";
import {
  buildMonthlyAnalyticsModel,
  clampMonthlyScope,
  type QuestHistory,
} from "@/components/monthly-analytics/monthlyAnalyticsModel";
import {
  MonthOverviewGrid,
  MonthStepper,
  MonthlyAnalyticsBody,
  MonthlyAnalyticsHeader,
} from "@/components/monthly-analytics/MonthlyAnalyticsWidgets";
import "@/components/home-warm/warm-instrument.css";
import "@/components/monthly-analytics/monthly-analytics.css";

function buildPhaseLabel(activities: Activity[], challenge: ChallengeV2, syncStatus: SyncStatusPayload): string {
  const contract = buildLiveWeekContract(activities, challenge);
  const model = buildWarmHomeModel(activities, challenge, syncStatus, contract);
  // Akash's season/phase/block model has a current_block with real dates; Skanda's classic
  // challenge model has no phase concept at all - fall back to the challenge's own dates.
  const blockStart = challenge.phase?.current_block.start_date ?? challenge.challenge?.start_date;
  const blockEnd = challenge.phase?.current_block.end_date ?? challenge.challenge?.end_date;
  const start = blockStart ? new Date(`${blockStart}T00:00:00`) : new Date();
  const end = blockEnd ? new Date(`${blockEnd}T00:00:00`) : new Date();
  const totalWeeks = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime() + 86_400_000) / (7 * 86_400_000)),
  );
  const currentWeek = Math.min(
    totalWeeks,
    Math.max(1, Math.floor((Date.now() - start.getTime()) / (7 * 86_400_000)) + 1),
  );
  return `${model.phaseName.toUpperCase()} · ${model.blockName.toUpperCase()} · WK ${currentWeek}/${totalWeeks}`;
}

export default function MonthlyAnalytics() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported}>
      {data && <MonthlyAnalyticsContent data={data} />}
    </RepoDataGate>
  );
}

function MonthlyAnalyticsContent({ data }: { data: RepoData }) {
  const activities = data.activities as Activity[];
  const challengeData = data.challenge_v2 as unknown as ChallengeV2;
  const syncStatusData = data.sync_status as SyncStatusPayload;
  // Fallback matches build-aggregate.mjs's own default for a repo that never ran
  // generate_quest_history.py.
  const questHistory = (data.quest_history as QuestHistory | undefined) ?? {
    generated_at: "",
    quests: {},
  };

  const now = new Date();
  const [scope, setScope] = useState(() =>
    clampMonthlyScope({ year: now.getFullYear(), month: now.getMonth() }, activities),
  );

  const model = useMemo(
    () => buildMonthlyAnalyticsModel(activities, questHistory, scope),
    [activities, questHistory, scope],
  );

  const phaseLabel = buildPhaseLabel(activities, challengeData, syncStatusData);
  const monthIndex = model.monthOverview.findIndex((cell) => cell.month === scope.month);
  const canGoPrev = monthIndex > 0;
  const canGoNext = monthIndex >= 0 && monthIndex < model.monthOverview.length - 1;

  function selectMonth(month: number) {
    setScope((current) => clampMonthlyScope({ ...current, month }, activities));
  }

  function selectYear(year: number) {
    setScope((current) => clampMonthlyScope({ year, month: current.month }, activities));
  }

  function goPrevMonth() {
    if (!canGoPrev) return;
    selectMonth(model.monthOverview[monthIndex - 1].month);
  }

  function goNextMonth() {
    if (!canGoNext) return;
    selectMonth(model.monthOverview[monthIndex + 1].month);
  }

  return (
    <div className="wi-shell">
      <div className="wi-board">
        <InstrumentHeader
          phaseLabel={phaseLabel}
          mobilePhaseLabel={`BUILD · ${model.monthLabel}`}
          syncHealthy={syncStatusData.status === "success" || syncStatusData.status === "none"}
          syncLabel={syncStatusData.status}
          workoutsHref="/workouts"
          analyticsHref="/analytics/monthly"
          currentRoute="/analytics/monthly"
        />

        <main className="ma-page">
          <MonthlyAnalyticsHeader
            year={scope.year}
            yearOptions={model.yearOptions}
            onYearChange={selectYear}
          />

          <MonthOverviewGrid
            months={model.monthOverview}
            selectedMonth={scope.month}
            onSelectMonth={selectMonth}
          />

          <MonthStepper
            monthLabel={model.monthLabel}
            year={scope.year}
            summaryLine={model.summaryLine}
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            onPrev={goPrevMonth}
            onNext={goNextMonth}
          />

          <MonthlyAnalyticsBody model={model} />
        </main>
      </div>
    </div>
  );
}
