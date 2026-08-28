import { type CSSProperties, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";
import { clamp, hoverCapable, smoothPath } from "./chartUtils";
import type {
  CalisthenicsActivityHeatmapSnapshot,
  CalisthenicsCoachReadSnapshot,
  CalisthenicsHeaderStats,
  CalisthenicsImprovingSnapshot,
  ConsistencySnapshot,
  SkillTrackRow,
  SkillTracksSnapshot,
  SkillTrackStep,
  TestedE1rmSnapshot,
} from "./calisthenicsLensModel";

// ─── Lens header ────────────────────────────────────────────────────────────

export function CalisthenicsLensHeader({ header }: { header: CalisthenicsHeaderStats }) {
  return (
    <div className="sa-lens-header">
      <div className="sa-lens-header__title">
        <span className="sa-sport-chip is-calisthenics">CALISTHENICS</span>
        <h2>Skills &amp; strength</h2>
        <span className="sa-lens-header__meta">{header.metaLine}</span>
      </div>
      <span className="sa-lens-header__meta sa-calisthenics-block-meta">{header.blockMeta}</span>
    </div>
  );
}

// ─── Skill Tracks (XL anchor — paper card per Sport Analytics.dc.html §1b) ───

function SkillTrackStepCell({
  step,
  onHover,
  onLeave,
}: {
  step: SkillTrackStep;
  onHover: () => void;
  onLeave: () => void;
}) {
  const className = [
    "sa-cal-skill-step",
    step.state === "done" ? "is-done" : "",
    step.state === "current" ? "is-current" : "",
    step.state === "future" ? "is-future" : "",
    step.muted ? "is-muted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="sa-cal-skill-step-wrap">
      <div className={className} onMouseEnter={onHover} onMouseLeave={onLeave}>
        {step.label}
      </div>
      {step.sub ? <span className="sa-cal-skill-step__sub">{step.sub}</span> : null}
    </div>
  );
}

function SkillTrackRowView({
  track,
  hoverStep = null,
  onStepHover,
  onStepLeave,
  variant = "desktop",
}: {
  track: SkillTrackRow;
  hoverStep?: SkillTrackStep | null;
  onStepHover?: (step: SkillTrackStep) => void;
  onStepLeave?: () => void;
  variant?: "desktop" | "mobile";
}) {
  if (variant === "mobile") {
    return (
      <div className="sa-cal-skill-track sa-cal-skill-track--compact">
        <div className="sa-cal-skill-track__compact-head">
          <strong>{track.name}</strong>
          {track.projLabel ? (
            <span className="sa-cal-skill-track__compact-proj">{track.projLabel}</span>
          ) : null}
        </div>
        <div className="sa-cal-skill-track__compact-bars">
          {track.steps.map((step) => (
            <span className={`is-${step.state}${step.muted ? " is-muted" : ""}`} key={step.id} />
          ))}
        </div>
        {track.mobileCaption ? (
          <span className="sa-cal-skill-track__compact-caption">{track.mobileCaption}</span>
        ) : null}
      </div>
    );
  }

  const projLabel = hoverStep ? hoverStep.label : track.projLabel;
  const projSub = hoverStep ? hoverStep.projection?.math ?? hoverStep.sub : track.projSub;

  return (
    <div className="sa-cal-skill-track">
      <div className="sa-cal-skill-track__head">
        <div className="sa-cal-skill-track__title">
          <strong>{track.name}</strong>
          <span>{track.metric}</span>
        </div>
        {track.note ? <em className="sa-cal-skill-track__note wi-desktop-only">{track.note}</em> : null}
      </div>
      <div className="sa-cal-skill-track__ladder">
        {track.steps.map((step, index) => (
          <div className="sa-cal-skill-track__segment" key={step.id}>
            <SkillTrackStepCell
              step={step}
              onHover={() => onStepHover?.(step)}
              onLeave={() => onStepLeave?.()}
            />
            {index < track.steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`sa-cal-skill-track__link${step.state === "done" ? " is-done" : ""}`}
              />
            ) : null}
          </div>
        ))}
        {projLabel || projSub ? (
          <div className="sa-cal-skill-track__projection">
            {projLabel ? <span className="sa-cal-skill-track__proj-label">{projLabel}</span> : null}
            {projSub ? <span className="sa-cal-skill-track__proj-sub">{projSub}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SkillTracksCard({ skillTracks }: { skillTracks: SkillTracksSnapshot }) {
  const [hover, setHover] = useState<{ trackId: string; step: SkillTrackStep } | null>(null);

  return (
    <section className="sa-card sa-cal-skill-tracks">
      <span className="sa-card-label">SKILL TRACKS — THE LADDERS</span>
      <div className="wi-desktop-only sa-cal-skill-tracks__desktop">
        {skillTracks.tracks.map((track) => (
          <SkillTrackRowView
            key={track.id}
            hoverStep={hover?.trackId === track.id ? hover.step : null}
            onStepHover={(step) => {
              if (hoverCapable()) setHover({ trackId: track.id, step });
            }}
            onStepLeave={() => setHover(null)}
            track={track}
            variant="desktop"
          />
        ))}
      </div>
      <div className="wi-mobile-only sa-cal-skill-tracks__mobile">
        {skillTracks.tracks.map((track) => (
          <SkillTrackRowView key={`${track.id}-mobile`} track={track} variant="mobile" />
        ))}
      </div>
      <p className="sa-cal-skill-tracks__method wi-desktop-only">
        EACH FUTURE STEP SHOWS SESSIONS TO TARGET · HOVER A STEP → PROJECTED DATE + THE MATH APPEARS AT ROW END (LIVE) · EVERY MISSED SESSION SLIDES IT RIGHT
      </p>
    </section>
  );
}

// ─── Am I improving ─────────────────────────────────────────────────────────

export function CalisthenicsImprovingCard({ improving }: { improving: CalisthenicsImprovingSnapshot }) {
  return (
    <section className="sa-card sa-cal-improving">
      <div className="sa-card-kicker">
        <span className="sa-card-label">AM I IMPROVING — AGREED BENCHMARKS</span>
        <span className="sa-cal-improving__kicker">SET WITH COACH AT SETUP</span>
      </div>
      {improving.available ? (
        <>
          {improving.rows.map((row) => (
            <div className="sa-cal-improving__row" key={row.name}>
              <div className="sa-cal-improving__row-head">
                <span>{row.name}</span>
                <span>
                  {row.startLabel} → <b>{row.nowLabel}</b> / {row.targetLabel}
                  {row.improving === null ? "" : row.improving ? " ▲" : ""}
                </span>
              </div>
              {row.progressPercent !== null ? (
                <div className="sa-cal-improving__bar">
                  <span style={{ width: `${row.progressPercent}%` } as CSSProperties} />
                </div>
              ) : null}
            </div>
          ))}
          {improving.coachLine ? <p className="sa-cal-improving__coach">{improving.coachLine}</p> : null}
        </>
      ) : (
        <p className="sa-empty-note">No calisthenics benchmarks in the challenge record yet.</p>
      )}
    </section>
  );
}

// ─── Tested e1RM ────────────────────────────────────────────────────────────

function E1rmTrend({ points }: { points: TestedE1rmSnapshot["points"] }) {
  const width = 380;
  const height = 86;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((p) => p.e1rmKg);
    const minimum = Math.min(...values) - 4;
    const maximum = Math.max(...values) + 4;
    const range = Math.max(1, maximum - minimum);
    const x = (index: number) => (points.length === 1 ? width / 2 : (index / (points.length - 1)) * width);
    const y = (value: number) => height - 12 - ((value - minimum) / range) * (height - 28);
    return { minimum, maximum, coords: points.map((p, i) => ({ x: x(i), y: y(p.e1rmKg), point: p })) };
  }, [points]);

  function handleScrub(event: ReactMouseEvent<SVGSVGElement>) {
    if (!hoverCapable() || !chart) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    setHoverIndex(Math.round(fraction * (points.length - 1)));
  }

  if (!chart) return null;

  const scrub = hoverIndex === null ? null : chart.coords[hoverIndex];

  return (
    <svg
      aria-label="Pull-up e1RM trend. Hover to inspect each test."
      className="sa-cal-e1rm__chart"
      onMouseLeave={() => setHoverIndex(null)}
      onMouseMove={handleScrub}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <line className="sa-dashed-line" x1="0" x2={width} y1="64" y2="64" />
      <path d={smoothPath(chart.coords.map((c) => ({ x: c.x, y: c.y })))} />
      {chart.coords.map((coord) => (
        <circle
          key={coord.point.date}
          className={coord.point.isPr ? "is-pr" : ""}
          cx={coord.x}
          cy={coord.y}
          r={coord.point.isPr ? 6 : 5}
        />
      ))}
      {scrub ? (
        <text className="sa-cal-e1rm__pr-label" textAnchor="middle" x={scrub.x} y="12">
          {scrub.point.isPr ? "PR" : scrub.point.dateLabel}
        </text>
      ) : null}
    </svg>
  );
}

export function TestedE1rmCard({ tested }: { tested: TestedE1rmSnapshot }) {
  return (
    <section className="sa-card sa-cal-e1rm wi-desktop-only">
      <div className="sa-cal-e1rm__head">
        <span className="sa-cal-e1rm__tested">TESTED</span>
        <span className="sa-card-label">STRENGTH — PULL-UP e1RM + PR MARKS</span>
      </div>
      {!tested.available ? (
        <p className="sa-empty-note">
          No pull-up e1RM tests logged yet — ringed dots mark test days once history builds. Hover a dot for that day&apos;s detail; the line between them is an estimate.
        </p>
      ) : (
        <>
          <div className="sa-cal-e1rm__body">
            <div className="sa-cal-e1rm__readout">
              <span className="sa-cal-e1rm__label">PULL-UP e1RM</span>
              <strong>
                {tested.currentKg?.toFixed(1)}
                <span>KG</span>
              </strong>
              {tested.blockDeltaKg !== null && tested.blockDeltaKg !== 0 ? (
                <span className="sa-cal-e1rm__delta">
                  {tested.blockDeltaKg > 0 ? "▲" : "▼"} {Math.abs(tested.blockDeltaKg).toFixed(1)} THIS BLOCK
                  {tested.prDateLabel ? ` · PR ${tested.prDateLabel}` : ""}
                </span>
              ) : null}
            </div>
            <E1rmTrend points={tested.points} />
          </div>
          <p className="sa-cal-e1rm__note">
            <b>e1RM</b> = estimated 1-rep max, worked out from your reps × weight — so you see progress without ever maxing out.
          </p>
        </>
      )}
    </section>
  );
}

// ─── Consistency ────────────────────────────────────────────────────────────

export function ConsistencyCard({ consistency }: { consistency: ConsistencySnapshot }) {
  return (
    <section className="sa-card sa-cal-consistency">
      <div className="sa-card-kicker">
        <span className="sa-card-label">CONSISTENCY — SKILL SESSIONS / WK</span>
        {consistency.available ? (
          <span className="sa-cal-consistency__streak">{consistency.streakWeeks}-WK STREAK</span>
        ) : null}
      </div>
      {!consistency.available ? (
        <p className="sa-empty-note">No calisthenics sessions logged yet.</p>
      ) : (
        <>
          <div className="sa-cal-consistency__grid">
            {consistency.weeks.map((week) => (
              <span
                className={week.hitFloor ? "is-hit" : "is-miss"}
                key={week.weekKey}
                title={`${week.sessionCount} session${week.sessionCount === 1 ? "" : "s"}`}
              />
            ))}
          </div>
          <div className="sa-cal-consistency__axis">
            <span>12 WKS AGO</span>
            <span>FILLED = HIT WEEKLY FLOOR</span>
            <span>NOW</span>
          </div>
          {consistency.coachLine ? <p className="sa-cal-consistency__coach">{consistency.coachLine}</p> : null}
        </>
      )}
    </section>
  );
}

// ─── Coach read ─────────────────────────────────────────────────────────────

export function CalisthenicsCoachReadCard({ coachRead }: { coachRead: CalisthenicsCoachReadSnapshot }) {
  if (!coachRead.available) return null;
  return (
    <section className="sa-card sa-cal-coach-read">
      <span className="sa-card-label">COACH&apos;S READ</span>
      <p>{coachRead.text}</p>
    </section>
  );
}

// ─── Calisthenics activity heatmap (spine) ───────────────────────────────────

export function CalisthenicsActivityHeatmapCard({ heatmap }: { heatmap: CalisthenicsActivityHeatmapSnapshot }) {
  const visibleCount = Math.min(3, heatmap.months.length);
  const latestStart = Math.max(0, heatmap.months.length - visibleCount);
  const [windowStart, setWindowStart] = useState(latestStart);

  useEffect(() => {
    setWindowStart(Math.max(0, heatmap.months.length - Math.min(3, heatmap.months.length)));
  }, [heatmap.months]);

  const visibleMonths = heatmap.months.slice(windowStart, windowStart + visibleCount);
  const rangeLabel = `${visibleMonths[0]?.label ?? ""}–${visibleMonths.at(-1)?.label ?? ""}`;

  return (
    <section className="sa-cal-heatmap">
      <div className="sa-cal-heatmap__header">
        <span className="sa-card-label">CALISTHENICS ACTIVITY · {rangeLabel}</span>
        <div className="sa-cal-heatmap__tools">
          <div className="sa-cal-heatmap__legend">
            <span><i className="is-calisthenics" />CAL</span>
          </div>
          <div className="sa-cal-heatmap__paging" aria-label="Calisthenics activity month window">
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
              onClick={() => setWindowStart((current) => Math.min(latestStart, current + visibleCount))}
              type="button"
            >
              →
            </button>
          </div>
        </div>
      </div>
      <div className="sa-cal-heatmap__body">
        <div className="sa-cal-heatmap__months">
          {visibleMonths.map((month) => (
            <div className="sa-cal-heatmap__month" key={month.label}>
              <strong>{month.label}</strong>
              <div className="sa-cal-heatmap__days">
                {Array.from("MTWTFSS").map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div className="sa-cal-heatmap__grid">
                {month.cells.slice(0, 28).map((cell, index) => (
                  <i className={cell === "empty" ? "is-empty" : "is-calisthenics"} key={`${month.label}-${index}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="sa-cal-heatmap__stats">
          <span className="sa-cal-heatmap__stats-kicker">52W · ALL TIME</span>
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
