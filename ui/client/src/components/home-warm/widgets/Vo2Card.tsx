import { type MouseEvent as ReactMouseEvent, useState } from "react";
import { clamp } from "../formatUtils";
import type { TrendPointSnapshot, Vo2Snapshot } from "../snapshots";

function Vo2Trend({ points }: { points: TrendPointSnapshot[] }) {
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const width = 360;
  const values = points.map((point) => point.value);
  const minimum = values.length > 0 ? Math.min(...values) : 0;
  const maximum = values.length > 0 ? Math.max(...values) : 1;
  const range = Math.max(1, maximum - minimum);
  const coordinates = points.map((point, index) => ({
    x: points.length <= 1 ? width : (index / (points.length - 1)) * width,
    y: 59 - ((point.value - minimum) / range) * 44,
  }));
  const last = coordinates.at(-1);
  const activePoint = scrubIndex === null ? null : points[scrubIndex];
  const activeCoordinate = scrubIndex === null ? null : coordinates[scrubIndex];

  function handleScrub(event: ReactMouseEvent<SVGSVGElement>) {
    if (points.length === 0 || !window.matchMedia("(hover: hover) and (pointer: fine)").matches)
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    setScrubIndex(Math.round(fraction * Math.max(0, points.length - 1)));
  }

  return (
    <svg
      aria-label={
        points.length > 0
          ? "VO₂ Max trend. Hover to inspect observations."
          : "VO₂ Max trend unavailable."
      }
      className="wi-vo2-card__trend"
      data-wi-scrub={points.length > 0 ? "vo2" : undefined}
      onMouseLeave={points.length > 0 ? () => setScrubIndex(null) : undefined}
      onMouseMove={points.length > 0 ? handleScrub : undefined}
      viewBox="0 0 360 72"
    >
      <rect height="30" rx="7" width="360" x="0" y="22" />
      {coordinates.length > 1 ? (
        <polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")} />
      ) : null}
      {last ? <circle cx={last.x} cy={last.y} r="4" /> : null}
      {activePoint && activeCoordinate ? (
        <g className="wi-vo2-scrub">
          <line x1={activeCoordinate.x} x2={activeCoordinate.x} y1="8" y2="58" />
          <circle cx={activeCoordinate.x} cy={activeCoordinate.y} r="4" />
          <foreignObject
            height="28"
            width="96"
            x={clamp(activeCoordinate.x - 48, 2, width - 98)}
            y={clamp(activeCoordinate.y - 31, 1, 40)}
          >
            <div className="wi-trend-scrub__chip">
              <b>{activePoint.value.toFixed(1)}</b>
              <span>{activePoint.label}</span>
            </div>
          </foreignObject>
        </g>
      ) : null}
      <text x="0" y="70">
        {points[0]?.label ?? "NO SOURCE"}
      </text>
      <text textAnchor="end" x="360" y="70">
        NOW
      </text>
    </svg>
  );
}

export function Vo2Card({ vo2 }: { vo2: Vo2Snapshot }) {
  const available = vo2.status === "available" && vo2.value !== null;

  return (
    <section className={`wi-vo2-card ${available ? "" : "is-unavailable"}`}>
      <div className="wi-card-kicker">
        <span>VO₂ MAX · 12 MO</span>
        <b>{available ? vo2.percentileLabel : "NOT IMPORTED"}</b>
      </div>
      <div className="wi-vo2-card__value">
        <strong>{available ? vo2.value?.toFixed(1) : "—"}</strong>
        <span>
          {available ? (
            <>
              ml/kg/min · <b>▲ {vo2.delta?.toFixed(1)}</b>
            </>
          ) : (
            "No Apple Health VO₂ observations"
          )}
        </span>
      </div>
      <Vo2Trend points={vo2.trend} />
      <p>{vo2.read}</p>
    </section>
  );
}
