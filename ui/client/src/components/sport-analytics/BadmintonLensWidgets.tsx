import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AmIImprovingSnapshot,
  BadmintonActivityHeatmapSnapshot,
  BadmintonHeaderStats,
  BadmintonHeatmapCell,
  BadmintonMode,
  BestMonthSnapshot,
  EffortSnapshot,
  HeadToHeadSnapshot,
  SessionShapeSnapshot,
  WinRateSnapshot,
  WinRateWindow,
} from "./badmintonLensModel";

import { areaPath, clamp, hoverCapable, smoothPath } from "./chartUtils";

const EMPTY_WIN_RATE_WINDOW: WinRateWindow = {
  winPct: 0,
  wins: 0,
  losses: 0,
  games: 0,
  verdict: "no games logged in this window",
  trend: [],
};

function formatMonthYearAxis(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
    .toUpperCase()
    .replace(" ", " '");
}

// ─── Lens header ────────────────────────────────────────────────────────────

export function BadmintonLensHeader({
  header,
  mode,
  onModeChange,
}: {
  header: BadmintonHeaderStats;
  mode: BadmintonMode;
  onModeChange: (mode: BadmintonMode) => void;
}) {
  return (
    <div className="sa-lens-header">
      <div className="sa-lens-header__title">
        <span className="sa-sport-chip is-badminton">BADMINTON</span>
        <h2>The club ledger</h2>
        <span className="sa-lens-header__meta">
          {header.totalSessions} sessions · {header.sessionsWithMatchData} with match data
        </span>
      </div>
      <div className="sa-toggle" role="group" aria-label="Scope: ranked or all games">
        <button
          type="button"
          className={mode === "ranked" ? "is-active" : ""}
          onClick={() => onModeChange("ranked")}
        >
          RANKED · {header.rankedGameCount}
        </button>
        <button
          type="button"
          className={mode === "all" ? "is-active" : ""}
          onClick={() => onModeChange("all")}
        >
          ALL · {header.allGameCount}
        </button>
      </div>
    </div>
  );
}

// ─── Win Rate hero (XL anchor — matches the Engine hero's own scale) ───────

function WinRateGauge({ winRate, current }: { winRate: WinRateSnapshot; current: number }) {
  const width = 500;
  const x = (value: number) => clamp((value / 100) * width, 0, width);
  const bandX = x(winRate.bandLow);
  const bandWidth = Math.max(12, x(winRate.bandHigh) - bandX);
  const markerX = x(current);
  const fiftyX = x(50);
  const bandEndX = bandX + bandWidth;
  const labelOffset = 12;

  function labelX(preferred: number, side: "left" | "right") {
    const min = side === "left" ? 28 : markerX + 18;
    const max = side === "right" ? width - 28 : markerX - 18;
    return clamp(preferred, min, max);
  }

  const lowLabelX = labelX(bandX - labelOffset, "left");
  const highLabelX = labelX(bandEndX + labelOffset, "right");

  return (
    <svg
      className="wi-engine-gauge"
      role="img"
      viewBox="0 0 500 88"
      aria-label={`Current win rate ${current}%; usual band ${winRate.bandLow} to ${winRate.bandHigh}.`}
    >
      <line x1="0" x2="500" y1="48" y2="48" />
      <line className="wi-engine-gauge__fifty" x1={fiftyX} x2={fiftyX} y1="38" y2="64" />
      <rect height="20" rx="4" width={bandWidth} x={bandX} y="38" />
      <path d={`M${markerX} 32l6-11h-12z`} />
      <line className="wi-engine-gauge__marker" x1={markerX} x2={markerX} y1="32" y2="64" />
      <text textAnchor="end" x={lowLabelX} y="18">
        {winRate.bandLow}%
      </text>
      <text textAnchor="start" x={highLabelX} y="18">
        {winRate.bandHigh}%
      </text>
      <text className="is-muted" textAnchor="middle" x={fiftyX} y="78">
        50%
      </text>
      <text className="is-muted" x="0" y="84">
        0%
      </text>
      <text className="is-muted" textAnchor="end" x="500" y="84">
        100%
      </text>
    </svg>
  );
}

function WinRateTrend({ points }: { points: WinRateWindow["trend"] }) {
  const width = 820;
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const safePoints =
    points.length > 0
      ? points
      : [
          {
            label: "NOW",
            sessionWinPct: 0,
            rollingWinPct: null,
            activityId: 0,
            timestamp: Date.now(),
          },
        ];
  const values = safePoints.flatMap((p) => [p.sessionWinPct, p.rollingWinPct ?? p.sessionWinPct]);
  const minimum = Math.max(0, Math.min(...values) - 6);
  const maximum = Math.min(100, Math.max(...values) + 6);
  const range = Math.max(1, maximum - minimum);
  const x = (index: number) =>
    safePoints.length === 1 ? width : (index / (safePoints.length - 1)) * width;
  const y = (value: number) => 154 - ((value - minimum) / range) * 96;
  const sessionCoords = safePoints.map((p, i) => ({ x: x(i), y: y(p.sessionWinPct) }));
  const rollingCoords = safePoints
    .map((p, i) => (p.rollingWinPct === null ? null : { x: x(i), y: y(p.rollingWinPct) }))
    .filter((c): c is { x: number; y: number } => c !== null);
  const last = rollingCoords.at(-1) ?? sessionCoords.at(-1) ?? { x: width, y: 130 };
  const scrubPoint = scrubIndex === null ? null : safePoints[scrubIndex];
  const scrubCoordinate = scrubIndex === null ? null : sessionCoords[scrubIndex];
  const startLabel = formatMonthYearAxis(safePoints[0]?.timestamp ?? Date.now());
  const endLabel = formatMonthYearAxis(safePoints.at(-1)?.timestamp ?? Date.now());

  function handleScrub(event: ReactMouseEvent<SVGSVGElement>) {
    if (!hoverCapable() || points.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    setScrubIndex(Math.round(fraction * (safePoints.length - 1)));
  }

  return (
    <svg
      aria-label="Win rate trend. Hover to inspect each session."
      className="wi-engine-trend wi-trend-scrub sa-winrate-hero__trend"
      data-wi-scrub="winrate"
      onMouseLeave={() => setScrubIndex(null)}
      onMouseMove={handleScrub}
      role="img"
      viewBox="0 0 820 230"
    >
      <rect height="120" rx="14" width="820" x="0" y="40" />
      <path d={smoothPath(sessionCoords)} className="sa-winrate-hero__line-session" />
      <path d={smoothPath(rollingCoords)} />
      <circle cx={last.x} cy={last.y} r="5.5" />
      {scrubCoordinate && scrubPoint ? (
        <g aria-hidden="true">
          <line
            className="wi-trend-scrub__guide"
            x1={scrubCoordinate.x}
            x2={scrubCoordinate.x}
            y1="40"
            y2="160"
          />
          <foreignObject
            className="wi-trend-scrub__chip"
            height="30"
            width="150"
            x={clamp(scrubCoordinate.x - 75, 0, width - 150)}
            y="4"
          >
            <div>
              {scrubPoint.label} · {scrubPoint.sessionWinPct}%
              {scrubPoint.rollingWinPct !== null ? ` · ${scrubPoint.rollingWinPct}% 4WK` : ""}
            </div>
          </foreignObject>
        </g>
      ) : null}
      <text x="0" y="216">
        {startLabel}
      </text>
      <text textAnchor="end" x="820" y="216">
        {endLabel}
      </text>
    </svg>
  );
}

export function WinRateHero({ winRate }: { winRate: WinRateSnapshot }) {
  const [scope, setScope] = useState<"8w" | "52w">("8w");
  const [yearPage, setYearPage] = useState(0);
  const yearWindows = winRate.yearWindows;
  const currentYearWindow = yearWindows[yearPage];
  const window_ =
    scope === "8w" ? winRate.eightWeek : (currentYearWindow?.window ?? EMPTY_WIN_RATE_WINDOW);
  const hasGames = winRate.available && window_.games > 0;
  const canGoOlder = scope === "52w" && yearPage < yearWindows.length - 1;
  const canGoNewer = scope === "52w" && yearPage > 0;

  return (
    <section className="sa-winrate-hero">
      <div className="wi-engine-card__topline">
        <span>
          WIN RATE · {scope === "8w" ? "LAST 8W" : (currentYearWindow?.rangeLabel ?? "52 WEEKS")}
        </span>
        <div className="sa-winrate-hero__controls">
          {scope === "52w" ? (
            <div className="sa-winrate-hero__pager" role="group" aria-label="Page through years">
              <button
                type="button"
                aria-label="Older 52-week window"
                disabled={!canGoOlder}
                onClick={() => setYearPage((p) => p + 1)}
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="More recent 52-week window"
                disabled={!canGoNewer}
                onClick={() => setYearPage((p) => p - 1)}
              >
                ›
              </button>
            </div>
          ) : null}
          <div className="sa-toggle sa-toggle--ghost" role="group" aria-label="Time window">
            <button
              type="button"
              className={scope === "8w" ? "is-active" : ""}
              onClick={() => setScope("8w")}
            >
              8W
            </button>
            <button
              type="button"
              className={scope === "52w" ? "is-active" : ""}
              onClick={() => {
                setScope("52w");
                setYearPage(0);
              }}
            >
              52W
            </button>
          </div>
        </div>
      </div>

      {!hasGames ? (
        <p className="sa-empty-note">
          {scope === "8w"
            ? "No recent games logged yet — this widget mounts once matches are in the log."
            : "No games logged in this window yet."}
        </p>
      ) : (
        <>
          <div className="wi-engine-card__readout">
            <div className="wi-engine-card__number">
              <strong>{window_.winPct}%</strong>
              <em>{window_.verdict}</em>
            </div>
            <WinRateGauge winRate={winRate} current={window_.winPct} />
            <WinRateTrend points={window_.trend} />
          </div>
          <div className="wi-engine-card__method">
            BAND {winRate.bandLow}–{winRate.bandHigh}% · NOT A SCORE TO MAXIMIZE · THIN = PER
            SESSION · BOLD = 4-WK ROLLING
          </div>
        </>
      )}
    </section>
  );
}

// ─── Session shape ──────────────────────────────────────────────────────────

export function SessionShapeCard({ shape }: { shape: SessionShapeSnapshot }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 360;
  const plotHeight = 168;

  const chart = useMemo(() => {
    if (shape.points.length === 0) return null;
    const values = shape.points
      .flatMap((p) => [p.fiftyTwoWeekWinPct, p.eightWeekWinPct])
      .filter((v): v is number => v !== null);
    const min = Math.max(0, Math.min(...values) - 8);
    const max = Math.min(100, Math.max(...values) + 8);
    const range = Math.max(1, max - min);
    const baseline = plotHeight - 6;
    const x = (index: number) =>
      shape.points.length === 1 ? width / 2 : (index / (shape.points.length - 1)) * width;
    const y = (value: number) => baseline - ((value - min) / range) * (plotHeight - 20);
    const windowCoords = shape.points
      .map((p, i) =>
        p.fiftyTwoWeekWinPct === null ? null : { x: x(i), y: y(p.fiftyTwoWeekWinPct) },
      )
      .filter((c): c is { x: number; y: number } => c !== null);
    const recentCoords = shape.points
      .map((p, i) => (p.eightWeekWinPct === null ? null : { x: x(i), y: y(p.eightWeekWinPct) }))
      .filter((c): c is { x: number; y: number } => c !== null);
    const maxSamples = Math.max(...shape.points.map((point) => point.sampleCount), 1);
    return {
      x,
      y,
      min,
      max,
      baseline,
      maxSamples,
      showFifty: min <= 50 && max >= 50,
      fiftyY: min <= 50 && max >= 50 ? y(50) : null,
      windowCoords,
      recentCoords,
      windowArea: areaPath(windowCoords, baseline),
      recentArea: areaPath(recentCoords, baseline),
    };
  }, [shape.points]);

  if (!shape.available || !chart) {
    return (
      <section className="sa-card sa-session-shape">
        <span className="sa-card-label">SESSION SHAPE — WHEN YOU WIN</span>
        <p className="sa-empty-note">Not enough games at each position yet to show a shape.</p>
      </section>
    );
  }

  const hovered = hoverIndex === null ? null : shape.points[hoverIndex];
  const hoveredX = hoverIndex === null ? null : chart.x(hoverIndex);
  const hoveredWindowY =
    hovered?.fiftyTwoWeekWinPct != null ? chart.y(hovered.fiftyTwoWeekWinPct) : null;
  const hoveredRecentY = hovered?.eightWeekWinPct != null ? chart.y(hovered.eightWeekWinPct) : null;

  function handleScrub(event: ReactMouseEvent<HTMLDivElement>) {
    if (!hoverCapable() || shape.points.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    setHoverIndex(Math.round(fraction * (shape.points.length - 1)));
  }

  return (
    <section className="sa-card sa-session-shape">
      <div className="sa-card-kicker">
        <span className="sa-card-label">SESSION SHAPE — WHEN YOU WIN</span>
        <div className="sa-legend">
          <span>
            <i className="is-muted" />
            52W
          </span>
          <span>
            <i className="is-ink" />
            8W
          </span>
        </div>
      </div>
      <p className="sa-session-shape__read">{shape.read}</p>
      <div className="sa-session-shape__plot">
        <div aria-hidden="true" className="sa-session-shape__y-axis">
          <span>{Math.round(chart.max)}%</span>
          {chart.showFifty ? <span className="is-fifty">50%</span> : null}
          <span>{Math.round(chart.min)}%</span>
        </div>
        <div className="sa-session-shape__plot-main">
          <div
            className="sa-session-shape__chart-area"
            onMouseLeave={() => setHoverIndex(null)}
            onMouseMove={handleScrub}
          >
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${width} ${plotHeight}`}
              preserveAspectRatio="none"
            >
              {chart.fiftyY !== null ? (
                <line
                  x1="0"
                  y1={chart.fiftyY}
                  x2={width}
                  y2={chart.fiftyY}
                  className="sa-dashed-line"
                />
              ) : null}
              <path d={chart.windowArea} className="sa-session-shape__area-all" />
              <path d={chart.recentArea} className="sa-session-shape__area-recent" />
              <path d={smoothPath(chart.windowCoords)} className="sa-session-shape__line-all" />
              <path d={smoothPath(chart.recentCoords)} className="sa-session-shape__line-recent" />
              {hoveredX !== null ? (
                <line
                  x1={hoveredX}
                  y1="0"
                  x2={hoveredX}
                  y2={plotHeight}
                  className="sa-session-shape__guide"
                />
              ) : null}
            </svg>
            {hovered && hoveredX !== null && hoveredWindowY !== null ? (
              <span
                aria-hidden="true"
                className="sa-session-shape__dot sa-session-shape__dot-all"
                style={{
                  left: `${(hoveredX / width) * 100}%`,
                  top: `${(hoveredWindowY / plotHeight) * 100}%`,
                }}
              />
            ) : null}
            {hovered && hoveredX !== null && hoveredRecentY !== null ? (
              <span
                aria-hidden="true"
                className="sa-session-shape__dot sa-session-shape__dot-recent"
                style={{
                  left: `${(hoveredX / width) * 100}%`,
                  top: `${(hoveredRecentY / plotHeight) * 100}%`,
                }}
              />
            ) : null}
            {hovered && hoveredX !== null ? (
              <div
                className="sa-session-shape__chip"
                style={{ left: `${clamp((hoveredX / width) * 100, 12, 88)}%` }}
              >
                G{hovered.gameNumber}
                {hovered.fiftyTwoWeekWinPct !== null ? ` · 52W ${hovered.fiftyTwoWeekWinPct}%` : ""}
                {hovered.eightWeekWinPct !== null ? ` · 8W ${hovered.eightWeekWinPct}%` : ""}
                {hovered.sampleCount > 0 ? ` · n=${hovered.sampleCount}` : ""}
              </div>
            ) : null}
          </div>
          <div className="sa-session-shape__volume" aria-hidden="true">
            {shape.points.map((point, index) => (
              <span
                key={point.gameNumber}
                className={hoverIndex === index ? "is-active" : ""}
                style={{ height: `${Math.max(12, (point.sampleCount / chart.maxSamples) * 100)}%` }}
              />
            ))}
          </div>
          <div className="sa-session-shape__x-labels">
            {shape.points.map((point, index) => (
              <span
                key={point.gameNumber}
                className={
                  index === 0 || index === shape.points.length - 1 || point.gameNumber % 4 === 0
                    ? "is-visible"
                    : ""
                }
              >
                G{point.gameNumber}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Best month ─────────────────────────────────────────────────────────────

export function BestMonthCard({ bestMonth }: { bestMonth: BestMonthSnapshot }) {
  return (
    <section className="sa-card sa-best-month">
      <span className="sa-card-label">BEST MONTH</span>
      {bestMonth.available ? (
        <>
          <strong>{bestMonth.label}</strong>
          <span className="sa-best-month__meta">
            {bestMonth.winPct}% WIN RATE · {bestMonth.sessionCount} SESSIONS
          </span>
          <em>
            {bestMonth.isHighestVolume
              ? "Your highest-volume block yet — the wins followed the work."
              : "Your best stretch on record — the wins outpaced the rest."}
          </em>
        </>
      ) : (
        <p className="sa-empty-note">No month has enough sessions yet to call a best one.</p>
      )}
    </section>
  );
}

// ─── Head-to-head ───────────────────────────────────────────────────────────

export function HeadToHeadCard({ headToHead }: { headToHead: HeadToHeadSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  const collapsedCount = 3;
  const expandedCount = 10;
  if (!headToHead.available) {
    return (
      <section className="sa-card sa-h2h">
        <span className="sa-card-label">HEAD-TO-HEAD — REGULAR OPPONENTS</span>
        <p className="sa-empty-note">No repeat opponents with enough games logged yet.</p>
      </section>
    );
  }

  const visible = expanded
    ? headToHead.rows.slice(0, expandedCount)
    : headToHead.rows.slice(0, collapsedCount);

  return (
    <section className="sa-card sa-h2h">
      <span className="sa-card-label">HEAD-TO-HEAD — REGULAR OPPONENTS</span>
      <div className="sa-h2h__head">
        <span>OPPONENT</span>
        <span>LAST 52W</span>
        <span>LAST 8W</span>
        <span>DIRECTION</span>
      </div>
      {visible.map((row) => (
        <div className="sa-h2h__row" key={row.name}>
          <span className="sa-h2h__name">{row.name}</span>
          <span className="sa-h2h__record">{row.fiftyTwoWeekRecord}</span>
          <span className={`sa-h2h__record is-${row.tone}`}>{row.recentRecord}</span>
          <span className={`sa-h2h__direction is-${row.tone}`}>{row.direction}</span>
        </div>
      ))}
      {headToHead.rows.length > collapsedCount ? (
        <button type="button" className="sa-h2h__toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "SHOW FEWER ▲" : "SHOW MORE ▾"}
        </button>
      ) : null}
    </section>
  );
}

// ─── Am I improving ─────────────────────────────────────────────────────────

export function AmIImprovingCard({ improving }: { improving: AmIImprovingSnapshot }) {
  return (
    <section className="sa-card sa-improving">
      <span className="sa-card-label">AM I IMPROVING</span>
      {improving.available ? (
        <>
          <div className="sa-improving__head">
            <span>METRIC</span>
            <span>LAST 52W</span>
            <span>LAST 8W</span>
          </div>
          {improving.rows.map((row) => (
            <div className="sa-improving__row" key={row.label}>
              <span className="sa-improving__metric">{row.label}</span>
              <span className="sa-improving__all">{row.fiftyTwoWeek}</span>
              <span
                className={`sa-improving__recent ${row.improved === null ? "" : row.improved ? "is-up" : "is-down"}`}
              >
                {row.recent} {row.improved === null ? "" : row.improved ? "▲" : "▼"}
              </span>
            </div>
          ))}
        </>
      ) : (
        <p className="sa-empty-note">Not enough recent match data to compare yet.</p>
      )}
    </section>
  );
}

// ─── Effort ─────────────────────────────────────────────────────────────────

export function EffortCard({ effort }: { effort: EffortSnapshot }) {
  return (
    <section className="sa-card sa-effort">
      <span className="sa-card-label">EFFORT — HR ZONES, ALL SESSIONS</span>
      {effort.available ? (
        <>
          <div className="sa-effort__bar">
            {effort.zones.map((zone) => (
              <span
                key={zone.label}
                style={{ width: `${zone.percent}%`, "--zone-color": zone.color } as CSSProperties}
              />
            ))}
          </div>
          <div className="sa-effort__legend">
            {effort.zones.map((zone) => (
              <span className="sa-effort__legend-item" key={zone.label}>
                <span className="sa-effort__zone-label">
                  <i style={{ background: zone.color }} />
                  {zone.label}
                </span>
                <span className="sa-effort__zone-pct">{zone.percent}%</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="sa-empty-note">No heart-rate stream on these sessions yet.</p>
      )}
    </section>
  );
}

const BADMINTON_HEATMAP_LEGEND: Array<{ cell: BadmintonHeatmapCell; label: string }> = [
  { cell: "ranked", label: "RNK" },
  { cell: "league", label: "LGE" },
  { cell: "friendly", label: "FRN" },
  { cell: "casual", label: "CAS" },
];

export function BadmintonActivityHeatmapCard({
  heatmap,
}: {
  heatmap: BadmintonActivityHeatmapSnapshot;
}) {
  const visibleCount = Math.min(3, heatmap.months.length);
  const latestStart = Math.max(0, heatmap.months.length - visibleCount);
  const [windowStart, setWindowStart] = useState(latestStart);

  useEffect(() => {
    setWindowStart(Math.max(0, heatmap.months.length - Math.min(3, heatmap.months.length)));
  }, [heatmap.months]);

  const visibleMonths = heatmap.months.slice(windowStart, windowStart + visibleCount);
  const rangeLabel = `${visibleMonths[0]?.label ?? ""}–${visibleMonths.at(-1)?.label ?? ""}`;

  return (
    <section className="sa-badminton-heatmap">
      <div className="sa-badminton-heatmap__header">
        <span className="sa-card-label">BADMINTON ACTIVITY · {rangeLabel}</span>
        <div className="sa-badminton-heatmap__tools">
          <div className="sa-badminton-heatmap__legend">
            {BADMINTON_HEATMAP_LEGEND.map((item) => (
              <span key={item.cell}>
                <i className={`is-${item.cell}`} />
                {item.label}
              </span>
            ))}
          </div>
          <div
            className="sa-badminton-heatmap__paging"
            aria-label="Badminton activity month window"
          >
            <button
              aria-label="Show previous three months"
              disabled={windowStart === 0}
              onClick={() => setWindowStart((current) => Math.max(0, current - visibleCount))}
              type="button"
            >
              ←
            </button>
            <button
              aria-label="Show next three months"
              disabled={windowStart >= latestStart}
              onClick={() =>
                setWindowStart((current) => Math.min(latestStart, current + visibleCount))
              }
              type="button"
            >
              →
            </button>
          </div>
        </div>
      </div>
      <div className="sa-badminton-heatmap__body">
        <div className="sa-badminton-heatmap__months">
          {visibleMonths.map((month) => (
            <div className="sa-badminton-heatmap__month" key={month.label}>
              <strong>{month.label}</strong>
              <div className="sa-badminton-heatmap__days">
                {Array.from("MTWTFSS").map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div className="sa-badminton-heatmap__grid">
                {month.cells.slice(0, 28).map((cell, index) => (
                  <i
                    className={cell === "empty" ? "is-empty" : `is-${cell}`}
                    key={`${month.label}-${index}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sa-badminton-heatmap__stats">
          <span className="sa-badminton-heatmap__stats-kicker">52W · ALL TIME</span>
          <div>
            <strong>{heatmap.sessionCount52w}</strong>
            <span>SESSIONS · 52W</span>
          </div>
          <div>
            <strong>{heatmap.currentWeeklyStreak}W</strong>
            <span>WEEKLY STREAK</span>
          </div>
          <div>
            <strong>{heatmap.longestWeeklyStreak}W</strong>
            <span>BEST STREAK · ALL</span>
          </div>
        </div>
      </div>
    </section>
  );
}
