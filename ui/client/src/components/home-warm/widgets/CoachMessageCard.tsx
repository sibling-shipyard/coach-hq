import { Link } from "wouter";
import type { CoachMessageSnapshot } from "../snapshots";

export function CoachMessageCard({
  message,
}: {
  message: CoachMessageSnapshot;
}) {
  return (
    <Link
      className="wi-coach-message-card"
      href={`/coach-chat?seed=${encodeURIComponent(message.conversation_seed_id)}`}
    >
      <span className="wi-card-label">A NOTE FROM COACH</span>
      <p>{message.body}</p>
      <strong>
        CONTINUE WITH COACH <span aria-hidden="true">→</span>
      </strong>
    </Link>
  );
}
