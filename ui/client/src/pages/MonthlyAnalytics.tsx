import { useMemo, useState } from "react";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import { InstrumentHeader } from "@/components/home-warm/WarmInstrumentWidgets";
import { buildWarmHomeModel, type SyncStatusPayload } from "@/components/home-warm/warmHomeModel";
import { buildLiveWeekContract } from "@/components/home-warm/liveWeekContract";
import type { Activity } from "@/lib/activities";
import type { SplitLedger } from "@/lib/challenge";
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

function buildPhaseLabel(
  activities: Activity[],
  ledger: SplitLedger,
  syncStatus: SyncStatusPayload,
): string {
  const contract = buildLiveWeekContract(activities);
  const model = buildWarmHomeModel(activities, ledger, syncStatus, contract);
  const currentSeason = ledger.seasons?.seasons?.find(
    (s: any) => s.id === ledger.seasons.current_season_id,
  );
  const blockStart = currentSeason?.start_date;
  const blockEnd = currentSeason?.end_date;
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
  const phaseName = currentSeason ? currentSeason.name : model.phaseName;
  const blockName = model.blockName;
  return `${phaseName.toUpperCase()} · ${blockName.toUpperCase()} · WK ${currentWeek}/${totalWeeks}`;
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
  const ledger = data.ledger as SplitLedger;
  const syncStatusData = data.sync_status as SyncStatusPayload;
  // Fallback matches build-dashboard-snapshot.mjs's own default for a repo that never ran
  // generate_quest_history.py.
  const questHistory = useMemo(
    () =>
      (data.quest_history as QuestHistory | undefined) ?? {
        generated_at: "",
        quests: {},
      },
    [data.quest_history],
  );

  const now = new Date();
  const [scope, setScope] = useState(() =>
    clampMonthlyScope({ year: now.getFullYear(), month: now.getMonth() }, activities),
  );

  const model = useMemo(
    () => buildMonthlyAnalyticsModel(activities, questHistory, scope),
    [activities, questHistory, scope],
  );

  const phaseLabel = buildPhaseLabel(activities, ledger, syncStatusData);
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
