import { Link } from "wouter";
import { SessionRow } from "../atoms/SessionRow";
import type { RecentSessionSnapshot } from "../snapshots";

export function RecentSessionsCard({
  sessions,
  staggerRows = false,
}: {
  sessions: RecentSessionSnapshot[];
  staggerRows?: boolean;
}) {
  return (
    <section className="wi-sessions-card">
      <div className="wi-card-kicker">
        <span className="wi-desktop-only">RECENT SESSIONS</span>
        <span className="wi-mobile-only">RECENT</span>
        <Link href="/analytics">All activity</Link>
      </div>
      <div className="wi-sessions-card__rows">
        {sessions.slice(0, 3).map((session) =>
          staggerRows ? (
            <div key={session.id} data-flutter>
              <SessionRow session={session} />
            </div>
          ) : (
            <SessionRow key={session.id} session={session} />
          ),
        )}
      </div>
    </section>
  );
}
