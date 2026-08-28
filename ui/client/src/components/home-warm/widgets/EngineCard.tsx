import { type CSSProperties, type MouseEvent as ReactMouseEvent, useState } from "react";
import { clamp } from "../formatUtils";
import type { EngineSnapshot, LoadMixSnapshot, TrendPointSnapshot } from "../snapshots";

function EngineGauge({ engine }: { engine: EngineSnapshot }) {
  const width = 500;
  const range = Math.max(1, engine.scaleHigh - engine.scaleLow);
  const x = (value: number) => clamp(((value - engine.scaleLow) / range) * width, 0, width);
  const fallbackLow = engine.load * 0.8;
  const fallbackHigh = engine.load * 1.2;
  const bandLow = engine.bandLow ?? fallbackLow;
  const bandHigh = engine.bandHigh ?? fallbackHigh;
  const bandX = x(bandLow);
  const bandWidth = Math.max(12, x(bandHigh) - bandX);
  const markerX = x(engine.load);

  return (
    <svg
      className="wi-engine-gauge"
      role="img"
      viewBox="0 0 500 88"
      aria-label={`Current load ${engine.load}; usual band ${Math.round(bandLow)} to ${Math.round(bandHigh)}.`}
    >
      <line x1="0" x2="500" y1="48" y2="48" />
      <rect height="20" rx="4" width={bandWidth} x={bandX} y="38" />
      <path d={`M${markerX} 32l6-11h-12z`} />
      <line className="wi-engine-gauge__marker" x1={markerX} x2={markerX} y1="32" y2="64" />
      <text x={bandX} y="28">
        {Math.round(bandLow)}
      </text>
      <text textAnchor="end" x={bandX + bandWidth} y="28">
        {Math.round(bandHigh)}
      </text>
      <text className="is-muted" x="0" y="84">
        {engine.scaleLow}
      </text>
      <text className="is-muted" textAnchor="end" x="500" y="84">
        {engine.scaleHigh}
      </text>
    </svg>
  );
}

function EngineTrend({ points }: { points: TrendPointSnapshot[] }) {
  const width = 820;
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const safePoints = points.length > 0 ? points : [{ label: "NOW", value: 0 }];
  const values = safePoints.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);
  const coordinates = safePoints.map((point, index) => ({
    x: safePoints.length === 1 ? width : (index / (safePoints.length - 1)) * width,
    y: 108 - ((point.value - minimum) / range) * 52,
  }));
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const last = coordinates.at(-1) ?? { x: width, y: 84 };
  const scrubPoint = scrubIndex === null ? null : safePoints[scrubIndex];
  const scrubCoordinate = scrubIndex === null ? null : coordinates[scrubIndex];

  function handleScrub(event: ReactMouseEvent<SVGSVGElement>) {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    setScrubIndex(Math.round(fraction * (safePoints.length - 1)));
  }

  return (
    <svg
      aria-label="Six-week load trend. Hover to inspect each week."
      className="wi-engine-trend wi-trend-scrub"
      data-wi-scrub="engine"
      onMouseLeave={() => setScrubIndex(null)}
      onMouseMove={handleScrub}
      role="img"
      viewBox="0 0 820 180"
    >
      <rect height="76" rx="14" width="820" x="0" y="42" />
      <polyline points={polyline} />
      <circle cx={last.x} cy={last.y} r="5.5" />
      {scrubCoordinate && scrubPoint ? (
        <g aria-hidden="true" data-wi-scrub-index={scrubIndex ?? undefined}>
          <line
            className="wi-trend-scrub__guide"
            x1={scrubCoordinate.x}
            x2={scrubCoordinate.x}
            y1="42"
            y2="118"
          />
          <foreignObject
            className="wi-trend-scrub__chip"
            height="30"
            width="132"
            x={clamp(scrubCoordinate.x - 66, 0, width - 132)}
            y="4"
          >
            <div>
              {(scrubPoint.weekLabel ?? scrubPoint.label).toUpperCase()} · {scrubPoint.value}
            </div>
          </foreignObject>
        </g>
      ) : null}
      <text x="0" y="176">
        {safePoints[0]?.label.toUpperCase()}
      </text>
      <text textAnchor="end" x="820" y="176">
        {safePoints.at(-1)?.label.toUpperCase()}
      </text>
    </svg>
  );
}

function EngineMix({ mix, totalHours }: { mix: LoadMixSnapshot[]; totalHours: number }) {
  const trackedHours = mix.reduce((sum, item) => sum + item.hours, 0);
  const denominator = Math.max(totalHours, trackedHours, 1);

  return (
    <div className="wi-engine-mix">
      <div className="wi-engine-mix__bar" aria-hidden="true">
        {mix.map((item) => (
          <span
            key={item.id}
            style={
              {
                "--mix-color": item.color,
                width: `${(item.hours / denominator) * 100}%`,
              } as CSSProperties
            }
          />
        ))}
        <i />
      </div>
      <div className="wi-engine-mix__legend">
        {mix
          .filter((item) => item.hours > 0)
          .map((item) => (
            <span key={item.id}>
              <i style={{ "--mix-color": item.color } as CSSProperties} />
              <span className="wi-desktop-only">
                {item.label.toUpperCase()} {item.hours.toFixed(1)}H
              </span>
              <span className="wi-mobile-only">
                {item.shortLabel.toUpperCase()} {item.hours.toFixed(1)}H
              </span>
            </span>
          ))}
        <span className="wi-engine-mix__total">
          {totalHours.toFixed(1)}H<span className="wi-desktop-only"> LOGGED</span>
        </span>
      </div>
    </div>
  );
}

export function EngineCard({ engine }: { engine: EngineSnapshot }) {
  return (
    <section className="wi-engine-card">
      <div className="wi-engine-card__topline">
        <span>ENGINE · {engine.weekLabel}</span>
        <span className="wi-engine-card__signal">{engine.signal}</span>
      </div>
      <div className="wi-engine-card__readout">
        <div className="wi-engine-card__number">
          <strong>{engine.load}</strong>
          <em>
            <span className="wi-desktop-only">{engine.verdict}</span>
            <span className="wi-mobile-only">{engine.compactVerdict ?? engine.verdict}</span>
          </em>
        </div>
        <EngineGauge engine={engine} />
        <EngineTrend points={engine.trend} />
      </div>
      <EngineMix mix={engine.mix} totalHours={engine.totalHours} />
      <div className="wi-engine-card__method">{engine.method}</div>
    </section>
  );
}
