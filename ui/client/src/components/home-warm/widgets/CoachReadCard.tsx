import type { CoachReadSnapshot } from "../snapshots";

export function CoachReadCard({ read }: { read: CoachReadSnapshot }) {
  return (
    <section className="wi-coach-read-card">
      <span className="wi-card-label">
        {read.eyebrow ?? "COACH'S READ"} · {read.dateLabel}
      </span>
      <p>{read.body}</p>
      <strong>{read.signature ?? "— PHELPS"}</strong>
    </section>
  );
}
