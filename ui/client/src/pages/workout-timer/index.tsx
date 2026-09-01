import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { RepoDataGate } from "@/components/RepoDataGate";
import { useRepoData, type RepoData } from "@/hooks/useRepoData";
import { WorkoutsData, validTemplates, validSessions } from "@/lib/workouts";
import { toLocalDateStr } from "@/lib/challenge";
import { WarmWorkoutOverview } from "./WarmWorkoutOverview";
import { WarmActiveTimer } from "./WarmActiveTimer";
import { WarmWorkoutComplete } from "./WarmWorkoutComplete";

export default function WorkoutTimer() {
  const { data, loading, error, schemaUnsupported } = useRepoData();
  return (
    <RepoDataGate loading={loading} error={error} schemaUnsupported={schemaUnsupported}>
      {data && <WorkoutTimerContent data={data} />}
    </RepoDataGate>
  );
}

function WorkoutTimerContent({ data }: { data: RepoData }) {
  const params = useParams<{ id: string }>();
  const workoutId = params.id;
  const workoutsData = data.workouts as WorkoutsData;

  const workout = useMemo(() => {
    const today = toLocalDateStr(new Date());
    const session = validSessions(workoutsData).find(
      (s) => s.id === workoutId && s.session_date === today,
    );
    if (session) return session;
    return validTemplates(workoutsData).find((t) => t.id === workoutId) ?? null;
  }, [workoutsData, workoutId]);

  const [screen, setScreen] = useState<"overview" | "active" | "complete">("overview");
  const [elapsed, setElapsed] = useState(0);

  if (!workout) {
    return (
      <div className="wi-shell">
        <div
          className="wi-board"
          style={{
            display: "flex",
            minHeight: "60vh",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <p>Workout not found.</p>
        </div>
      </div>
    );
  }

  if (screen === "overview") {
    return <WarmWorkoutOverview workout={workout} onStart={() => setScreen("active")} />;
  }
  if (screen === "active") {
    return (
      <WarmActiveTimer
        workout={workout}
        onComplete={(e) => {
          setElapsed(e);
          setScreen("complete");
        }}
        onQuit={() => setScreen("overview")}
      />
    );
  }
  return <WarmWorkoutComplete workout={workout} elapsed={elapsed} />;
}
