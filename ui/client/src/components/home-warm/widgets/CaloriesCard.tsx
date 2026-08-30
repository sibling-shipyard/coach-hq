import { type MouseEvent as ReactMouseEvent, useState } from "react";
import { clamp, formatCompact } from "../formatUtils";
import type { CaloriesSnapshot } from "../snapshots";

export function CaloriesCard({ calories }: { calories: CaloriesSnapshot }) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const hasTarget = calories.target !== null && calories.target > 0;
  const progress = hasTarget
    ? clamp((calories.current / calories.target!) * 100, 0, 100)
    : clamp(calories.pacePercent, 0, 100);
  const elapsedDays = Math.max(1, calories.elapsedDays ?? calories.dailyActual.length ?? 1);
  const activeDay = hoverDay === null ? null : clamp(hoverDay, 1, elapsedDays);
  const actualAtDay =
    activeDay === null ? null : (calories.dailyActual[activeDay - 1] ?? calories.current);
  const expectedAtDay =
    activeDay === null || !hasTarget ? null : calories.target! * (activeDay / calories.daysInMonth);
  const hoverPercent = activeDay === null ? 0 : (activeDay / calories.daysInMonth) * 100;

  function handlePaceHover(event: ReactMouseEvent<HTMLDivElement>) {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    const day = clamp(Math.round(fraction * calories.daysInMonth), 1, elapsedDays);
    setHoverDay(day);
  }

  return (
    <section className="wi-calories-card">
      <div className="wi-card-kicker">
        <span>CALORIES · {calories.monthLabel}</span>
        <b>{calories.daysLeft}D LEFT</b>
      </div>
      <div className="wi-calories-card__value">
        <strong>{formatCompact(calories.current)}</strong>
        <span>{hasTarget ? `/ ${formatCompact(calories.target!)} KCAL` : "KCAL LOGGED"}</span>
      </div>
      <div
        aria-label="Monthly calorie pace. Hover to compare actual and expected values by day."
        className="wi-calories-card__meter"
        data-wi-scrub="calories"
        onMouseLeave={() => setHoverDay(null)}
        onMouseMove={handlePaceHover}
      >
        <div className="wi-progress-track">
          <span style={{ width: `${progress}%` }} />
        </div>
        <i style={{ left: `${clamp(calories.pacePercent, 0, 100)}%` }} />
        {activeDay !== null && actualAtDay !== null ? (
          <>
            <i className="wi-calories-card__cursor" style={{ left: `${hoverPercent}%` }} />
            <div
              className="wi-calories-card__hover"
              data-wi-calories-day={activeDay}
              style={{ left: `${hoverPercent}%` }}
            >
              <span>
                {activeDay} {calories.monthLabel}
              </span>
              <b>{formatCompact(actualAtDay)} ACTUAL</b>
              <small>
                {expectedAtDay === null ? "OBSERVED" : `${formatCompact(expectedAtDay)} EXPECTED`}
              </small>
            </div>
          </>
        ) : null}
      </div>
      <div className="wi-calories-card__meta">
        <b>
          {hasTarget && calories.dailyNeeded !== null
            ? `${Math.round(calories.dailyNeeded)}/DAY NEEDED`
            : "MONTH TO DATE"}
        </b>
      </div>
    </section>
  );
}
