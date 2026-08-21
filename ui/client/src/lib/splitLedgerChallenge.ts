import type { ChallengeV2 } from "./challenge.js";

interface SplitLedger {
  seasons: { current_season_id: string | null; seasons: Array<{ id: string; name: string; start_date: string; end_date: string }> };
  quests: {
    weekly_targets: Record<string, { target: number }>;
    main_quest: { id: string; name: string; type: string; target: number; count_pattern?: string };
    quests: Array<{ id: string; name: string; type: string; status: string; start_date: string; end_date: string | null; target?: number; unit?: string; polarity?: string }>;
  };
  progress: { rows: Array<{ quest_id: string; date: string; status: string; value?: number | string | null }> };
  progressions: unknown;
}

/** Temporary projection for existing dashboard models; the persisted snapshot stays split-only. */
export function splitLedgerAsChallenge(ledger: SplitLedger): ChallengeV2 | null {
  const season = ledger.seasons.seasons.find((item) => item.id === ledger.seasons.current_season_id);
  if (!season || !ledger.quests.main_quest) return null;
  const rowsFor = (questId: string) => ledger.progress.rows.filter((row) => row.quest_id === questId);
  const questWithProgress = (quest: SplitLedger["quests"]["quests"][number]) => {
    const rows = rowsFor(quest.id);
    const latestValue = [...rows].reverse().find((row) => row.value != null)?.value;
    return {
      ...quest,
      status: quest.status === "graduated" ? "completed" : quest.status,
      completed_dates: rows.filter((row) => row.status === "completed").map((row) => row.date),
      missed_dates: rows.filter((row) => row.status === "missed").map((row) => row.date),
      excused_dates: rows.filter((row) => row.status === "excused").map((row) => row.date),
      ...(latestValue != null ? { current: Number(latestValue) } : {}),
    };
  };
  const mainRows = rowsFor(ledger.quests.main_quest.id);
  return {
    version: 4,
    season: { name: season.name, start_date: season.start_date, end_date: season.end_date },
    weekly_targets: Object.fromEntries(Object.entries(ledger.quests.weekly_targets).map(([key, value]) => [key, value.target])),
    main_quest: { ...ledger.quests.main_quest, completed_dates: mainRows.filter((row) => row.status === "completed").map((row) => row.date) },
    quests: ledger.quests.quests.map(questWithProgress),
  } as unknown as ChallengeV2;
}
