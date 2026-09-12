import type { RecentSessionSnapshot } from "./snapshots";

export function SessionRow({ session }: { session: RecentSessionSnapshot }) {
  return (
    <div className="wi-session-row">
      <span className="wi-session-row__date">{session.dateLabel}</span>
      <span className={`wi-session-row__vein is-${session.sport}`} />
      <strong title={session.title}>{session.title}</strong>
      <span className="wi-session-row__detail">{session.detail}</span>
      <b className={`is-${session.sport}`}>
        {session.load === null ? "—" : `+${session.load}`}
        {session.load === null ? null : <span className="wi-desktop-only"> LOAD</span>}
      </b>
    </div>
  );
}
