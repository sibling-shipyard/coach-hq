import { type CSSProperties, useState } from "react";
import { ActivityGlyph } from "../ActivityGlyph";
import { clamp } from "../formatUtils";
import type { CommitmentSnapshot } from "../snapshots";

function CommitmentBody({
  item,
  record,
  label,
  onToggle,
  pressed,
}: {
  item: CommitmentSnapshot;
  record: string | undefined;
  label: string;
  onToggle?: () => void;
  pressed?: boolean;
}) {
  return (
    <>
      <div className="wi-commitment-card__top">
        <ActivityGlyph kind={item.glyph} size={36} />
        <strong>
          {item.value}
          <small>{item.target === null ? "" : `/${item.target}`}</small>
        </strong>
      </div>
      <div className="wi-commitment-card__bottom">
        {item.alarm ? <em>The bar is cold.</em> : null}
        <div
          className={`wi-commitment-card__rule ${item.progress === null ? "is-recorded" : ""}`.trim()}
        >
          <span
            style={{
              width: `${item.progress === null ? (item.value > 0 ? 100 : 0) : clamp(item.progress, 0, 100)}%`,
            }}
          />
        </div>
        <div className="wi-commitment-card__meta">
          <span>{record ?? item.note}</span>
          {onToggle ? (
            <button
              type="button"
              className="wi-commitment-card__toggle"
              onClick={onToggle}
              aria-pressed={pressed}
              aria-label={`Show ${pressed ? "all" : "ranked"} badminton record`}
            >
              {label}
            </button>
          ) : (
            <b>{label}</b>
          )}
        </div>
      </div>
      <span className="sr-only">{item.label}</span>
    </>
  );
}

export function SportCommitmentCard({ item }: { item: CommitmentSnapshot }) {
  const [showRanked, setShowRanked] = useState(false);
  const canToggle = item.id === "badminton" && Boolean(item.hasRankedRecord && item.rankedRecord);
  const showingRanked = canToggle && showRanked;
  const className = ["wi-commitment-card", `is-${item.id}`, item.alarm ? "is-alarm" : ""]
    .filter(Boolean)
    .join(" ");
  const style = { "--sport-accent": item.accent } as CSSProperties;
  const record =
    item.id === "badminton" ? (showingRanked ? item.rankedRecord : item.allRecord) : undefined;
  const label = item.id === "badminton" ? (showingRanked ? "RANKED" : "ALL") : item.status;

  return (
    <article className={className} style={style}>
      <CommitmentBody
        item={item}
        record={record}
        label={label}
        onToggle={canToggle ? () => setShowRanked((value) => !value) : undefined}
        pressed={showingRanked}
      />
    </article>
  );
}
