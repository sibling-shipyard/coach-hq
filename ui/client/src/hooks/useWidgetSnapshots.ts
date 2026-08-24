import { useEffect, useState } from "react";
import { GOLDEN_SNAPSHOTS } from "@/lib/goldenDataset";
import type { WidgetSnapshotsFile } from "@/components/home-warm/snapshots";

export function useWidgetSnapshots(): WidgetSnapshotsFile | null {
  const [snapshots, setSnapshots] = useState<WidgetSnapshotsFile | null>(
    import.meta.env.DEV ? GOLDEN_SNAPSHOTS : null,
  );

  useEffect(() => {
    if (import.meta.env.DEV) return;
    const controller = new AbortController();
    fetch("/api/widget-snapshots", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as WidgetSnapshotsFile;
      })
      .then((value) => {
        if (value) setSnapshots(value);
      })
      .catch(() => {
        // The dashboard remains usable without the optional proactive message.
      });
    return () => controller.abort();
  }, []);

  return snapshots;
}
