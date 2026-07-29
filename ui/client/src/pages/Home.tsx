import { WarmInstrumentHome } from "@/components/home-warm/WarmInstrumentHome";
import { adaptCurrentWeek } from "@/components/home-warm/currentWeekAdapter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import { parseCurrentWeek } from "@/lib/currentWeek";
import type { Activity } from "@/lib/activities";
import type { ChallengeV2 } from "@/lib/challenge";
import type { SyncStatusPayload } from "@/components/home-warm/warmHomeModel";

export default function Home() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  const notOnboarded = !loading && !error && !schemaUnsupported && data != null && data.challenge_v2 == null;
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported} notOnboarded={notOnboarded}>
      {data && data.challenge_v2 != null && <HomeContent data={data} />}
    </RepoDataGate>
  );
}

function HomeContent({ data }: { data: RepoData }) {
  const activities = data.activities as Activity[];
  const challengeData = data.challenge_v2 as unknown as ChallengeV2;

  // Use the coach-authored plan when it's the current live week; otherwise leave the
  // prop undefined so WarmInstrumentHome falls back to the recorded activity-log view.
  const currentWeekRt = parseCurrentWeek(data.current_week);
  const currentWeek =
    currentWeekRt.availability.available && currentWeekRt.data
      ? adaptCurrentWeek(currentWeekRt.data, currentWeekRt.availability, activities)
      : undefined;

  return (
    <WarmInstrumentHome
      activities={activities}
      challengeData={challengeData}
      currentWeek={currentWeek}
      dataMode="live"
      syncStatus={data.sync_status as SyncStatusPayload}
    />
  );
}
