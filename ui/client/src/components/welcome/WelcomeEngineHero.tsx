import { useState } from "react";
import type {
  EngineSnapshot,
  TrendPointSnapshot,
} from "@/components/home-warm/WarmInstrumentWidgets";

const TREND_WIDTH = 420;
const TREND_HEIGHT = 150;
const BAND_TOP = 40;
const BAND_HEIGHT = 66;

/** Coach verdict copy keyed by trend week index (WK 24 → WK 29). */
const WEEK_VERDICTS = [
  "Building back — easy does it.",
  "Climbing into the band.",
  "Inside the band now.",
  "Steady — right where you want it.",
  "Holding the upper band.",
  "Optimal engine — hold here.",
] as const;

function verdictForWeek(index: number): string {
  return WEEK_VERDICTS[index] ?? WEEK_VERDICTS.at(-1)!;
}

function buildTrendSeries(points: EngineSnapshot["trend"]) {
  const trend: TrendPointSnapshot[] =
    points.length > 0 ? points.slice(-6) : [{ label: "NOW", value: 0, weekLabel: "NOW" }];
  const values = trend.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);

  const coordinates = trend.map((point, index) => ({
    x: trend.length === 1 ? TREND_WIDTH : (index / (trend.length - 1)) * TREND_WIDTH,
    y: BAND_TOP + BAND_HEIGHT - ((point.value - minimum) / range) * BAND_HEIGHT,
  }));

  return { trend, coordinates };
}

export function WelcomeEngineHero({ engine }: { engine: EngineSnapshot }) {
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const activeIndex = scrubIndex ?? (engine.trend.length > 0 ? engine.trend.length - 1 : 0);
  const activePoint = engine.trend[activeIndex] ?? engine.trend.at(-1);
  const displayValue = activePoint?.value ?? engine.load;
  const displayWeek = activePoint?.weekLabel ?? engine.weekLabel;
  const displayVerdict = scrubIndex === null ? engine.verdict : verdictForWeek(scrubIndex);

  const { trend, coordinates } = buildTrendSeries(engine.trend);
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const last = coordinates.at(-1) ?? { x: TREND_WIDTH, y: BAND_TOP };
  const scrubCoordinate = scrubIndex === null ? null : coordinates[scrubIndex];
  const scrubPoint = scrubIndex === null ? null : trend[scrubIndex];
  const dotCoordinate = scrubCoordinate ?? last;

  function handleZoneEnter(index: number) {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    setScrubIndex(index);
  }

  function handleZoneTap(index: number) {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    setScrubIndex((current) => (current === index ? null : index));
  }

  return (
    <aside className="welcome-engine-hero" aria-label="Weekly engine load">
      <div className="welcome-engine-hero__top">
        <span className="welcome-engine-hero__label">ENGINE · {displayWeek}</span>
        <span className="welcome-engine-hero__badge">{engine.signal}</span>
      </div>
      <div className="welcome-engine-hero__value">{displayValue}</div>
      <p className="welcome-engine-hero__verdict">{displayVerdict}</p>
      <div className="welcome-engine-hero__trend-wrap" onMouseLeave={() => setScrubIndex(null)}>
        <svg
          aria-label="Six-week load trend. Hover to inspect each week."
          className="welcome-engine-hero__trend"
          role="img"
          viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <rect x="0" y={BAND_TOP} width={TREND_WIDTH} height={BAND_HEIGHT} rx="12" />
          <polyline className="welcome-engine-hero__trend-line" points={polyline} />
          <circle
            className="welcome-engine-hero__trend-dot"
            cx={dotCoordinate.x}
            cy={dotCoordinate.y}
            r="5.5"
          />
          {scrubCoordinate && scrubPoint ? (
            <g aria-hidden="true">
              <line
                className="wi-trend-scrub__guide"
                x1={scrubCoordinate.x}
                x2={scrubCoordinate.x}
                y1={BAND_TOP}
                y2={BAND_TOP + BAND_HEIGHT}
              />
            </g>
          ) : null}
          <text className="welcome-engine-hero__trend-axis" x="0" y={TREND_HEIGHT - 10}>
            {trend[0]?.label.toUpperCase()}
          </text>
          <text
            className="welcome-engine-hero__trend-axis"
            textAnchor="end"
            x={TREND_WIDTH}
            y={TREND_HEIGHT - 10}
          >
            {trend.at(-1)?.label.toUpperCase()}
          </text>
        </svg>
        <div className="welcome-engine-hero__trend-zones" aria-hidden="true">
          {trend.map((_, index) => (
            <div
              key={index}
              className="welcome-engine-hero__trend-zone"
              data-i={index}
              onMouseEnter={() => handleZoneEnter(index)}
              onClick={() => handleZoneTap(index)}
            />
          ))}
        </div>
      </div>
      <blockquote className="welcome-engine-hero__quote">
        &ldquo;The engine is warm and the band is holding.&rdquo;
      </blockquote>
      <p className="welcome-engine-hero__hint">HOVER THE TREND — READ ANY WEEK</p>
    </aside>
  );
}
