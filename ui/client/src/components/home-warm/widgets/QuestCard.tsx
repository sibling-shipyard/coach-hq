import { type CSSProperties } from "react";
import { clamp } from "../formatUtils";
import type { QuestSnapshot } from "../snapshots";

export function QuestCard({ quest, compact = false }: { quest: QuestSnapshot; compact?: boolean }) {
  const progress = quest.target > 0 ? clamp((quest.completed / quest.target) * 100, 0, 100) : 0;

  return (
    <section className={`wi-quest-card ${compact ? "is-compact" : ""}`.trim()}>
      <div className="wi-card-kicker">
        <span>MAIN QUEST</span>
      </div>
      <div className="wi-quest-card__main">
        <span>{quest.name}</span>
        <strong>
          {quest.completed}
          <small> / {quest.target}</small>
        </strong>
      </div>
      <div className="wi-progress-track">
        <span style={{ width: `${progress}%` }} />
      </div>
      {!compact && quest.sideQuests.length > 0 ? (
        <div className="wi-quest-card__sides">
          <span className="wi-card-label">SIDE QUESTS</span>
          {quest.sideQuests.slice(0, 2).map((item) => {
            const sideProgress =
              item.target > 0 ? clamp((item.value / item.target) * 100, 0, 100) : 0;
            return (
              <div className="wi-side-quest" key={item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.value}/{item.target}
                  </span>
                </div>
                <div className="wi-progress-track">
                  <span
                    style={
                      { "--quest-color": item.color, width: `${sideProgress}%` } as CSSProperties
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
