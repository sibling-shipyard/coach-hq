import { useEffect, useState } from "react";
import { GOLDEN_SNAPSHOTS } from "@/lib/goldenDataset";
import type { WidgetSnapshotsFile } from "@/components/home-warm/snapshots";
import { captureFetchFailure } from "@/lib/observability";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function useWidgetSnapshots(): WidgetSnapshotsFile | null {
  const [snapshots, setSnapshots] = useState<WidgetSnapshotsFile | null>(
    import.meta.env.DEV ? GOLDEN_SNAPSHOTS : null,
  );

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const controller = new AbortController();
    fetch("/api/widget-snapshots", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          // Dashboard still renders without snapshots, but the athlete lost the proactive
          // message — one capture so the outage is not invisible.
          captureFetchFailure("/api/widget-snapshots", {
            kind: "server",
            status: response.status,
          });
          return null;
        }
        return (await response.json()) as WidgetSnapshotsFile;
      })
      .then((value) => {
        if (value) setSnapshots(value);
      })
      .catch((error: unknown) => {
        // Unmount aborts the in-flight request; that is cleanup, not a failure.
        if (isAbortError(error)) return;
        captureFetchFailure("/api/widget-snapshots", { kind: "network", error });
      });
    return () => controller.abort();
  }, []);

  return snapshots;
}
