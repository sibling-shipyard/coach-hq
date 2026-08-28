import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";
import { clamp, hoverCapable, smoothPath } from "./chartUtils";
import {
  formatDuration,
  formatPace,
  type BenchmarkSnapshot,
  type CoachReadSnapshot,
  type PbsSnapshot,
  type PaceTrendSnapshot,
  type RunningActivityHeatmapSnapshot,
  type RunningHeaderStats,
  type RunningScope,
  type WeeklyVolumeSnapshot,
} from "./runningLensModel";

// ─── Lens header ────────────────────────────────────────────────────────────

export function RunningLensHeader({ header }: { header: RunningHeaderStats }) {
  return (
    <div className="sa-lens-header">
      <div className="sa-lens-header__title">
        <span className="sa-sport-chip is-run">RUNNING</span>
        <h2>Road log</h2>
        <span className="sa-lens-header__meta">{header.metaLine}</span>
      </div>
    </div>
  );
}

// ─── Weekly Volume hero (XL anchor) ──────────────────────────────────────────

function VolumeGauge({ volume }: { volume: WeeklyVolumeSnapshot }) {
  const width = 500;
  const maxKm = Math.max(volume.bandHigh * 1.25, volume.currentKm, 1);
  const x = (value: number) => clamp((value / maxKm) * width, 0, width);
  const bandX = x(volume.bandLow);
  const bandWidth = Math.max(12, x(volume.bandHigh) - bandX);
  const markerX = x(volume.currentKm);

  return (
    <svg
      className="wi-engine-gauge sa-running-gauge"
      role="img"
      viewBox="0 0 500 88"
      aria-label={`This week ${volume.currentKm} km; usual band ${volume.bandLow} to ${volume.bandHigh} km.`}
    >
      <line x1="0" x2="500" y1="48" y2="48" />
      <rect height="20" rx="4" width={bandWidth} x={bandX} y="38" />
      <path d={`M${markerX} 32l6-11h-12z`} />
      <line className="wi-engine-gauge__marker" x1={markerX} x2={markerX} y1="32" y2="64" />
      <text textAnchor="end" x={clamp(bandX - 8, 0, width - 40)} y="18">
        {volume.bandLow} KM
      </text>
      <text textAnchor="start" x={clamp(bandX + bandWidth + 8, 40, width)} y="18">
        {volume.bandHigh} KM
      </text>
      <text className="is-muted" x="0" y="84">
        0 KM
      </text>
      <text className="is-muted" textAnchor="end" x="500" y="84">
        {Math.round(maxKm)} KM
      </text>
    </svg>
  );
}

function VolumeBarChart({
  weeks,
  bandLow,
  bandHigh,
}: {
  weeks: WeeklyVolumeSnapshot["weeks"];
  bandLow: number;
  bandHigh: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const maxKm = Math.max(...weeks.map((w) => w.km), bandHigh, 1);
  const bandTop = 24;
  const bandHeight = 38;
  const bandBottom = bandTop + bandHeight;
  const bandYTop = bandBottom - (bandHigh / maxKm) * (bandBottom - 8);
  const bandYBottom = bandBottom - (bandLow / maxKm) * (bandBottom - 8);

  function handleScrub(event: ReactMouseEvent<HTMLDivElement>) {
    if (!hoverCapable() || weeks.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    setHoverIndex(Math.round(fraction * (weeks.length - 1)));
  }

  return (
    <div
      className="sa-running-volume__bars"
      onMouseLeave={() => setHoverIndex(null)}
      onMouseMove={handleScrub}
    >
      <div
        aria-hidden="true"
        className="sa-running-volume__band-region"
        style={{
          top: `${(bandYTop / 78) * 100}%`,
          height: `${((bandYBottom - bandYTop) / 78) * 100}%`,
        }}
      />
      {weeks.map((week, index) => (
        <span
          key={week.weekKey}
          className={`sa-running-volume__bar${week.isCurrent ? " is-current" : ""}${hoverIndex === index ? " is-active" : ""}`}
          style={{
            height: week.km === 0 ? "3px" : `${Math.max(8, (week.km / maxKm) * 100)}%`,
            opacity: week.km === 0 ? 0.35 : 1,
          }}
        />
      ))}
      {hoverIndex !== null && weeks[hoverIndex] ? (
        <div
          className="sa-running-volume__chip"
          style={{ left: `${clamp((hoverIndex / Math.max(1, weeks.length - 1)) * 100, 12, 88)}%` }}
        >
          {weeks[hoverIndex].label}
          {weeks[hoverIndex].isCurrent ? " · THIS WK" : ""} · {weeks[hoverIndex].km} KM
          {weeks[hoverIndex].longestRunKm > 0
            ? ` · LONG ${weeks[hoverIndex].longestRunKm.toFixed(1)} KM`
            : ""}
        </div>
      ) : null}
    </div>
  );
}

export function WeeklyVolumeHero({
  volume,
  scope,
  onScopeChange,
}: {
  volume: WeeklyVolumeSnapshot;
  scope: RunningScope;
  onScopeChange: (scope: RunningScope) => void;
}) {
  if (!volume.available) {
    return (
      <section className="sa-running-volume-hero">
        <span className="wi-engine-card__topline">
          <span>WEEKLY VOLUME</span>
        </span>
        <p className="sa-empty-note">
          No runs with GPS logged yet — this widget mounts once distance is in the log.
        </p>
      </section>
    );
  }

  const bandLabel =
    volume.bandLow > 0 || volume.bandHigh > 0
      ? `8-WK BAND ${volume.bandLow}–${volume.bandHigh} KM`
      : "BUILDING BASELINE";

  return (
    <section className="sa-running-volume-hero">
      <div className="wi-engine-card__topline">
        <span>WEEKLY VOLUME · {scope === "8w" ? "LAST 8W" : "LAST 52W"}</span>
        <div className="sa-winrate-hero__controls">
          <div
            className="sa-toggle sa-toggle--ghost"
            role="group"
            aria-label="Weekly volume time window"
          >
            <button
              type="button"
              className={scope === "8w" ? "is-active" : ""}
              onClick={() => onScopeChange("8w")}
            >
              8W
            </button>
            <button
              type="button"
              className={scope === "52w" ? "is-active" : ""}
              onClick={() => onScopeChange("52w")}
            >
              52W
            </button>
          </div>
        </div>
      </div>

      <div className="wi-engine-card__readout sa-running-volume-hero__readout">
        <div className="wi-engine-card__number sa-running-volume-hero__number">
          <strong>{volume.currentKm.toFixed(1)}</strong>
          <em>{volume.verdict}</em>
        </div>
        <div className="sa-running-volume-hero__charts">
          <VolumeGauge volume={volume} />
          <VolumeBarChart
            weeks={volume.weeks}
            bandLow={volume.bandLow}
            bandHigh={volume.bandHigh}
          />
          <div className="sa-running-volume-hero__axis">
            <span>{scope === "8w" ? "8 WKS AGO" : "52 WKS AGO"}</span>
            <span>PER-WEEK KM · SHADED = BAND</span>
            <span>THIS WK</span>
          </div>
        </div>
      </div>

      {volume.footnote ? (
        <p className="sa-running-volume-hero__footnote">{volume.footnote}</p>
      ) : null}

      <div className="wi-engine-card__method">
        {bandLabel}
        {volume.weekOverWeekCapLabel ? ` · ${volume.weekOverWeekCapLabel}` : ""} · NOT A TARGET TO
        CHASE · HOVER BARS → KM + LONG RUN
      </div>
    </section>
  );
}

// ─── Benchmark ──────────────────────────────────────────────────────────────

function BenchmarkTrend({ points }: { points: BenchmarkSnapshot["trend"] }) {
  const width = 240;
  const height = 52;
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  if (points.length === 0) return null;

  const paces = points.map((p) => p.paceSecPerKm);
  const minimum = Math.min(...paces) - 8;
  const maximum = Math.max(...paces) + 8;
  const range = Math.max(1, maximum - minimum);
  const x = (index: number) =>
    points.length === 1 ? width : (index / (points.length - 1)) * width;
  const y = (pace: number) => height - 8 - ((pace - minimum) / range) * (height - 16);
  const coords = points.map((p, i) => ({ x: x(i), y: y(p.paceSecPerKm) }));
  const scrubPoint = scrubIndex === null ? null : points[scrubIndex];
  const scrubCoord = scrubIndex === null ? null : coords[scrubIndex];

  function handleScrub(event: ReactMouseEvent<SVGSVGElement>) {
    if (!hoverCapable()) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    setScrubIndex(Math.round(fraction * (points.length - 1)));
  }

  return (
    <svg
      aria-label="Benchmark pace trend. Hover to inspect each run."
      className="sa-running-benchmark__trend"
      onMouseLeave={() => setScrubIndex(null)}
      onMouseMove={handleScrub}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <path d={smoothPath(coords)} />
      {scrubCoord && scrubPoint ? (
        <g aria-hidden="true">
          <line
            className="wi-trend-scrub__guide"
            x1={scrubCoord.x}
            x2={scrubCoord.x}
            y1="4"
            y2={height - 4}
          />
          <foreignObject
            className="wi-trend-scrub__chip"
            height="28"
            width="130"
            x={clamp(scrubCoord.x - 65, 0, width - 130)}
            y="0"
          >
            <div>
              {scrubPoint.label} · {formatPace(scrubPoint.paceSecPerKm)}/KM
            </div>
          </foreignObject>
        </g>
      ) : null}
    </svg>
  );
}

export function BenchmarkCard({ benchmark }: { benchmark: BenchmarkSnapshot }) {
  if (!benchmark.available) return null;

  const deltaLabel =
    benchmark.deltaVs8wSec === null
      ? null
      : benchmark.deltaVs8wSec < 0
        ? `▲ ${Math.abs(benchmark.deltaVs8wSec)}S vs 8W`
        : benchmark.deltaVs8wSec > 0
          ? `▼ ${benchmark.deltaVs8wSec}S vs 8W`
          : "STEADY vs 8W";

  return (
    <section className="sa-card sa-running-benchmark wi-desktop-only">
      <div className="sa-card-kicker">
        <span className="sa-card-label">BENCHMARK — {benchmark.routeLabel}</span>
        {deltaLabel ? (
          <span className={`sa-running-benchmark__delta is-${benchmark.deltaTone}`}>
            {deltaLabel}
          </span>
        ) : null}
      </div>
      <div className="sa-running-benchmark__body">
        <div className="sa-running-benchmark__readout">
          <strong>{formatDuration(benchmark.latestTimeSec)}</strong>
          <span>{formatPace(benchmark.latestPaceSecPerKm)} /KM</span>
        </div>
        <BenchmarkTrend points={benchmark.trend} />
      </div>
      <em className="sa-running-benchmark__note">
        Same route every time — the only honest comparison. Down on the chart is faster.
      </em>
    </section>
  );
}

// ─── PBs ────────────────────────────────────────────────────────────────────

export function PbsCard({ pbs }: { pbs: PbsSnapshot }) {
  if (!pbs.available) {
    return (
      <section className="sa-card sa-running-pbs">
        <span className="sa-card-label">PBs — QUIET FLAGS</span>
        <p className="sa-empty-note">No standard-distance efforts logged yet.</p>
      </section>
    );
  }

  return (
    <section className="sa-card sa-running-pbs">
      <span className="sa-card-label">PBs — QUIET FLAGS</span>
      {pbs.rows.map((row) => (
        <div className="sa-running-pbs__row" key={row.label}>
          <span className="sa-running-pbs__distance">{row.label}</span>
          <span className={`sa-running-pbs__value${row.isPr ? " is-pr" : ""}`}>
            {row.timeSec !== null ? formatDuration(row.timeSec) : "—"} · {row.dateLabel}
            {row.isPr ? " — PR" : ""}
          </span>
        </div>
      ))}
      {pbs.nextMilestone ? (
        <div className="sa-running-pbs__milestone">
          <span>{pbs.nextMilestone.label}</span>
          <span>{pbs.nextMilestone.copy}</span>
        </div>
      ) : null}
    </section>
  );
}

// ─── Pace trend ─────────────────────────────────────────────────────────────

export function PaceTrendCard({ paceTrend }: { paceTrend: PaceTrendSnapshot }) {
  const width = 620;
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (paceTrend.points.length === 0) return null;
    const values = paceTrend.points.flatMap((p) => [
      p.paceSecPerKm,
      p.rollingPaceSecPerKm ?? p.paceSecPerKm,
    ]);
    const minimum = Math.min(...values) - 8;
    const maximum = Math.max(...values) + 8;
    const range = Math.max(1, maximum - minimum);
    const x = (index: number) =>
      paceTrend.points.length === 1 ? width / 2 : (index / (paceTrend.points.length - 1)) * width;
    const y = (pace: number) => 110 - ((pace - minimum) / range) * 70;
    const sessionCoords = paceTrend.points.map((p, i) => ({ x: x(i), y: y(p.paceSecPerKm) }));
    const rollingCoords = paceTrend.points
      .map((p, i) =>
        p.rollingPaceSecPerKm === null ? null : { x: x(i), y: y(p.rollingPaceSecPerKm) },
      )
      .filter((c): c is { x: number; y: number } => c !== null);
    return {
      minimum,
      maximum,
      sessionCoords,
      rollingCoords,
      startLabel: paceTrend.points[0]?.label ?? "",
      endLabel: paceTrend.points.at(-1)?.label ?? "",
    };
  }, [paceTrend.points]);

  function handleScrub(event: ReactMouseEvent<SVGSVGElement>) {
    if (!hoverCapable() || paceTrend.points.length === 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    setScrubIndex(Math.round(fraction * (paceTrend.points.length - 1)));
  }

  return (
    <section className="sa-card sa-running-pace-trend wi-desktop-only">
      <span className="sa-card-label">PACE TREND — LAST 52W</span>
      {!paceTrend.available || !chart ? (
        <p className="sa-empty-note">Not enough runs in this window yet.</p>
      ) : (
        <>
          <svg
            aria-label="Pace trend. Hover to inspect each run."
            className="sa-running-pace-trend__chart wi-trend-scrub"
            onMouseLeave={() => setScrubIndex(null)}
            onMouseMove={handleScrub}
            role="img"
            viewBox="0 0 620 130"
          >
            <rect height="90" rx="14" width="620" x="0" y="20" />
            <line className="sa-dashed-line" x1="0" x2="620" y1="65" y2="65" />
            <path
              className="sa-running-pace-trend__line-session"
              d={smoothPath(chart.sessionCoords)}
            />
            <path d={smoothPath(chart.rollingCoords)} />
            {scrubIndex !== null &&
            chart.sessionCoords[scrubIndex] &&
            paceTrend.points[scrubIndex] ? (
              <g aria-hidden="true">
                <line
                  className="wi-trend-scrub__guide"
                  x1={chart.sessionCoords[scrubIndex].x}
                  x2={chart.sessionCoords[scrubIndex].x}
                  y1="20"
                  y2="110"
                />
                <foreignObject
                  className="wi-trend-scrub__chip"
                  height="30"
                  width="170"
                  x={clamp(chart.sessionCoords[scrubIndex].x - 85, 0, width - 170)}
                  y="0"
                >
                  <div>
                    {paceTrend.points[scrubIndex].label} ·{" "}
                    {paceTrend.points[scrubIndex].distanceKm.toFixed(1)} KM ·{" "}
                    {formatPace(paceTrend.points[scrubIndex].paceSecPerKm)}/KM
                  </div>
                </foreignObject>
              </g>
            ) : null}
            <text x="0" y="126">
              {formatPace(chart.minimum + 8)}/KM
            </text>
            <text textAnchor="middle" x="310" y="126">
              DOWN = FASTER
            </text>
            <text textAnchor="end" x="620" y="126">
              {formatPace(chart.maximum - 8)}/KM
            </text>
          </svg>
          <span className="sa-running-pace-trend__method">
            THIN = PER RUN · AMBER = 4-WK ROLLING · HOVER-SCRUB → DATE, DISTANCE, PACE
          </span>
        </>
      )}
    </section>
  );
}

// ─── Coach's read ───────────────────────────────────────────────────────────

export function CoachReadCard({ coachRead }: { coachRead: CoachReadSnapshot }) {
  if (!coachRead.available) return null;
  return (
    <section className="sa-card sa-running-coach-read">
      <span className="sa-card-label">COACH&apos;S READ</span>
      <p>{coachRead.text}</p>
    </section>
  );
}

// ─── Running activity heatmap (spine) ───────────────────────────────────────

export function RunningActivityHeatmapCard({
  heatmap,
}: {
  heatmap: RunningActivityHeatmapSnapshot;
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
    <section className="sa-running-heatmap">
      <div className="sa-running-heatmap__header">
        <span className="sa-card-label">RUNNING ACTIVITY · {rangeLabel}</span>
        <div className="sa-running-heatmap__tools">
          <div className="sa-running-heatmap__legend">
            <span>
              <i className="is-run" />
              RUN
            </span>
          </div>
          <div className="sa-running-heatmap__paging" aria-label="Running activity month window">
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
      <div className="sa-running-heatmap__body">
        <div className="sa-running-heatmap__months">
          {visibleMonths.map((month) => (
            <div className="sa-running-heatmap__month" key={month.label}>
              <strong>{month.label}</strong>
              <div className="sa-running-heatmap__days">
                {Array.from("MTWTFSS").map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div className="sa-running-heatmap__grid">
                {month.cells.slice(0, 28).map((cell, index) => (
                  <i
                    className={cell === "empty" ? "is-empty" : "is-run"}
                    key={`${month.label}-${index}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sa-running-heatmap__stats">
          <span className="sa-running-heatmap__stats-kicker">52W · ALL TIME</span>
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
