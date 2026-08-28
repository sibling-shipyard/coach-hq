import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ActivityGlyph, type ActivityGlyphKind } from "@/components/home-warm/ActivityGlyph";
import type { WarmSportId } from "@/components/home-warm/WarmInstrumentWidgets";
import type {
  MonthlyAnalyticsModel,
  MonthlyEngineModel,
  MonthlyVo2Model,
  MonthOverviewCell,
  SideQuestMonthRow,
  SportBreakdownRow,
  WorkoutBreakdownModel,
} from "./monthlyAnalyticsModel";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatHours(hours: number): string {
  return hours.toFixed(1);
}

function formatCalories(value: number): string {
  return value.toLocaleString("en-GB");
}

function sportGlyph(id: WarmSportId): ActivityGlyphKind {
  if (id === "cycling") return "cycling";
  if (id === "badminton") return "badminton";
  if (id === "calisthenics") return "calisthenics";
  if (id === "foundation") return "foundation";
  if (id === "run") return "run";
  if (id === "strength") return "strength";
  if (id === "weight_training") return "weight_training";
  if (id === "hike") return "hike";
  if (id === "walk") return "walk";
  if (id === "cricket") return "cricket";
  if (id === "football") return "football";
  if (id === "workout") return "workout";
  if (id === "swim") return "swim";
  return "other";
}

function MonthlyEngineGauge({ engine }: { engine: MonthlyEngineModel }) {
  const width = 500;
  const load = engine.avgWeeklyLoad ?? 0;
  const range = Math.max(1, engine.scaleHigh - engine.scaleLow);
  const x = (value: number) => clamp(((value - engine.scaleLow) / range) * width, 0, width);
  const fallbackLow = load * 0.8;
  const fallbackHigh = load * 1.2;
  const bandLow = engine.bandLow ?? fallbackLow;
  const bandHigh = engine.bandHigh ?? fallbackHigh;
  const bandX = x(bandLow);
  const bandWidth = Math.max(12, x(bandHigh) - bandX);
  const markerX = x(load);

  return (
    <svg
      className="ma-engine-hero__gauge"
      role="img"
      viewBox="0 0 500 88"
      aria-label={
        engine.avgWeeklyLoad === null
          ? "Monthly load unavailable."
          : `Average weekly load ${engine.avgWeeklyLoad}; usual band ${Math.round(bandLow)} to ${Math.round(bandHigh)}.`
      }
    >
      <line x1="0" x2="500" y1="48" y2="48" />
      <rect height="20" rx="4" width={bandWidth} x={bandX} y="38" />
      {engine.avgWeeklyLoad !== null ? (
        <>
          <path d={`M${markerX} 32l6-11h-12z`} />
          <line
            className="ma-engine-hero__gauge-marker"
            x1={markerX}
            x2={markerX}
            y1="32"
            y2="64"
          />
        </>
      ) : null}
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

function MonthlyVo2Trend({ points }: { points: Array<{ label: string; value: number }> }) {
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const width = 316;
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
    if (points.length === 0 || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }
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
      className="ma-vo2-card__trend wi-trend-scrub"
      data-wi-scrub={points.length > 0 ? "vo2-monthly" : undefined}
      onMouseLeave={points.length > 0 ? () => setScrubIndex(null) : undefined}
      onMouseMove={points.length > 0 ? handleScrub : undefined}
      viewBox="0 0 316 66"
    >
      <rect height="30" rx="7" width="316" x="0" y="22" />
      {coordinates.length > 1 ? (
        <polyline points={coordinates.map((point) => `${point.x},${point.y}`).join(" ")} />
      ) : null}
      {last ? <circle cx={last.x} cy={last.y} r="4.5" /> : null}
      {activePoint && activeCoordinate ? (
        <g className="ma-vo2-scrub">
          <line x1={activeCoordinate.x} x2={activeCoordinate.x} y1="8" y2="58" />
          <circle cx={activeCoordinate.x} cy={activeCoordinate.y} r="4.5" />
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
    </svg>
  );
}

export function MonthlyAnalyticsHeader({
  year,
  yearOptions,
  onYearChange,
}: {
  year: number;
  yearOptions: number[];
  onYearChange: (year: number) => void;
}) {
  return (
    <div className="ma-header">
      <div>
        <h1 className="ma-header__title">Monthly Analytics</h1>
        <p className="ma-header__subtitle">
          A month, read back to you — training, engine and side quests.
        </p>
      </div>
      <div className="ma-header__years">
        <span className="ma-header__years-label">YEAR</span>
        <div className="ma-header__year-buttons">
          {yearOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={`ma-year-button ${option === year ? "is-active" : ""}`.trim()}
              onClick={() => onYearChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MonthOverviewGrid({
  months,
  selectedMonth,
  onSelectMonth,
}: {
  months: MonthOverviewCell[];
  selectedMonth: number;
  onSelectMonth: (month: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedMonth]);

  return (
    <div className="ma-month-grid" style={{ "--ma-month-count": months.length } as CSSProperties}>
      {months.map((cell) => {
        const active = cell.month === selectedMonth;
        return (
          <button
            key={cell.label}
            ref={active ? activeRef : undefined}
            type="button"
            className={`ma-month-cell ${active ? "is-active" : ""}`.trim()}
            title={`${cell.fullName}`}
            onClick={() => onSelectMonth(cell.month)}
          >
            <span className="ma-month-cell__label">{cell.label}</span>
            <span className="ma-month-cell__stats">
              <strong className="ma-month-cell__days">{cell.activeDays}d</strong>
              <span className="ma-month-cell__hours">{formatHours(cell.hours)}h</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MonthStepper({
  monthLabel,
  year,
  summaryLine,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
}: {
  monthLabel: string;
  year: number;
  summaryLine: string;
  canGoPrev: boolean;
  canGoNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="ma-stepper">
      <button
        type="button"
        className="ma-stepper__arrow"
        title="Previous month"
        disabled={!canGoPrev}
        onClick={onPrev}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18 L9 12 L15 6" />
        </svg>
      </button>
      <span className="ma-stepper__label">
        {monthLabel} {year}
      </span>
      <button
        type="button"
        className="ma-stepper__arrow"
        title="Next month"
        disabled={!canGoNext}
        onClick={onNext}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18 L15 12 L9 6" />
        </svg>
      </button>
      <span className="ma-stepper__summary">{summaryLine}</span>
    </div>
  );
}

export function MonthlyEngineHero({ engine }: { engine: MonthlyEngineModel }) {
  const maxWeekLoad = Math.max(...engine.weeks.map((week) => week.load), 1);

  return (
    <section className="ma-engine-hero">
      <div className="ma-engine-hero__topline">
        <span>ENGINE · MONTH AVG · {engine.monthLabel}</span>
        {engine.signal ? <span className="ma-engine-hero__signal">{engine.signal}</span> : null}
      </div>
      {engine.hasData && engine.avgWeeklyLoad !== null ? (
        <>
          <div className="ma-engine-hero__readout">
            <div className="ma-engine-hero__number">
              <strong>{engine.avgWeeklyLoad}</strong>
              <span className="ma-engine-hero__number-label">AVG WEEKLY LOAD</span>
              <em>{engine.verdict}</em>
            </div>
            <MonthlyEngineGauge engine={engine} />
          </div>
          {engine.weeks.length > 0 ? (
            <div className="ma-engine-hero__weeks">
              <span className="ma-engine-hero__weeks-label">WEEK BY WEEK</span>
              <div className="ma-engine-hero__week-bars">
                {engine.weeks.map((week) => (
                  <div className="ma-engine-hero__week" key={week.label}>
                    <span>{week.load > 0 ? week.load : "—"}</span>
                    <i
                      style={{
                        height: week.load > 0 ? `${(week.load / maxWeekLoad) * 100}%` : "8%",
                        opacity: week.isPartial ? 0.55 : 0.85,
                      }}
                    />
                    <small>{week.label}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="ma-engine-hero__empty">
          <p>{engine.verdict}</p>
        </div>
      )}
      <div className="ma-engine-hero__method">{engine.method}</div>
    </section>
  );
}

export function MonthlyVo2Card({ vo2 }: { vo2: MonthlyVo2Model }) {
  const available = vo2.status === "available" && vo2.value !== null;

  return (
    <section className={`ma-vo2-card ${available ? "" : "is-unavailable"}`.trim()}>
      <div className="ma-card-kicker">
        <span>VO₂ MAX · {vo2.monthLabel}</span>
        {available && vo2.percentileLabel ? <b>{vo2.percentileLabel}</b> : null}
      </div>
      {available ? (
        <>
          <div className="ma-vo2-card__value">
            <strong>{vo2.value?.toFixed(1)}</strong>
            <span>
              ml/kg/min
              {vo2.delta !== null ? (
                <>
                  {" "}
                  · <b>▲ {vo2.delta.toFixed(1)} this month</b>
                </>
              ) : null}
            </span>
          </div>
          <MonthlyVo2Trend points={vo2.trend} />
        </>
      ) : (
        <div className="ma-vo2-card__value">
          <strong>—</strong>
          <span>No Apple Health VO₂ observations</span>
        </div>
      )}
      <p>{vo2.read}</p>
    </section>
  );
}

export function MonthlySleepCard({ monthLabel }: { monthLabel: string }) {
  return (
    <section className="ma-sleep-card">
      <span className="sa-card-label">SLEEP · {monthLabel}</span>
      <div className="ma-sleep-card__body">
        <p>
          No sleep logged this month. When you&apos;re ready to watch recovery, connect a source —
          no rush.
        </p>
      </div>
      <button type="button" className="ma-sleep-card__connect">
        CONNECT A SOURCE
      </button>
    </section>
  );
}

function SportBreakdownRowView({ row }: { row: SportBreakdownRow }) {
  return (
    <div className="ma-breakdown__sport-row">
      <ActivityGlyph kind={sportGlyph(row.id)} size={22} />
      <span className="ma-breakdown__sport-label">{row.label}</span>
      <div className="ma-breakdown__sport-bar" aria-hidden="true">
        <span style={{ width: `${row.share * 100}%`, background: row.color }} />
      </div>
      <span className="ma-breakdown__sport-meta">
        {row.sessions} · {formatHours(row.hours)}h
      </span>
    </div>
  );
}

export function WorkoutBreakdownCard({ breakdown }: { breakdown: WorkoutBreakdownModel }) {
  return (
    <section className="ma-breakdown-card">
      <span className="sa-card-label">WORKOUT BREAKDOWN</span>
      {breakdown.hasData ? (
        <>
          <div className="ma-breakdown__stats">
            <div>
              <span>SESSIONS</span>
              <strong>{breakdown.sessions}</strong>
            </div>
            <div>
              <span>HOURS</span>
              <strong>{formatHours(breakdown.hours)}</strong>
            </div>
            <div>
              <span>CALORIES</span>
              <strong>{formatCalories(breakdown.calories)}</strong>
            </div>
            <div>
              <span>CONSISTENCY</span>
              <strong>
                {breakdown.consistencyPercent === null ? "—" : `${breakdown.consistencyPercent}%`}
              </strong>
            </div>
          </div>
          <div className="ma-breakdown__subline">
            <span>
              {breakdown.activeDays} active days out of {breakdown.elapsedDays}
            </span>
            {breakdown.vsPrevious ? (
              <span className="ma-breakdown__delta">
                {breakdown.vsPrevious.sessionsDelta >= 0 ? "+" : ""}
                {breakdown.vsPrevious.sessionsDelta} sessions ·{" "}
                {breakdown.vsPrevious.hoursDelta >= 0 ? "+" : ""}
                {breakdown.vsPrevious.hoursDelta.toFixed(1)}h vs last month
              </span>
            ) : null}
          </div>
          <div className="ma-breakdown__sports">
            {breakdown.sports.map((row) => (
              <SportBreakdownRowView key={row.id} row={row} />
            ))}
          </div>
        </>
      ) : (
        <p className="sa-empty-note">No sessions logged this month yet.</p>
      )}
    </section>
  );
}

function SideQuestRow({ quest }: { quest: SideQuestMonthRow }) {
  return (
    <div className="ma-side-quests__row">
      <span className="ma-side-quests__name">{quest.name}</span>
      <span className="ma-side-quests__num is-done">{quest.done}</span>
      <span className="ma-side-quests__num is-miss">{quest.miss}</span>
      <span className="ma-side-quests__num">{quest.excused}</span>
      <span className="ma-side-quests__num is-rate">
        {quest.rate === null ? "—" : `${quest.rate}%`}
      </span>
    </div>
  );
}

export function SideQuestsCard({
  sideQuests,
}: {
  sideQuests: MonthlyAnalyticsModel["sideQuests"];
}) {
  const featured =
    sideQuests.quests.find((quest) => quest.done + quest.miss > 0) ?? sideQuests.quests[0];
  const barWidth = featured?.rate ?? 0;

  return (
    <section className="ma-side-quests-card">
      <span className="sa-card-label">SIDE QUESTS</span>
      <div className="ma-side-quests__head">
        <span>QUEST</span>
        <span>DONE</span>
        <span>MISS</span>
        <span>EXC</span>
        <span>RATE</span>
      </div>
      {sideQuests.quests.map((quest) => (
        <SideQuestRow key={quest.id} quest={quest} />
      ))}
      {featured && featured.rateDeltaVsPrevious !== null ? (
        <div className="ma-side-quests__delta-row">
          <div className="ma-side-quests__delta-bar" aria-hidden="true">
            <span style={{ width: `${barWidth}%`, background: featured.color }} />
          </div>
          <span className="ma-side-quests__delta-label">
            {featured.rateDeltaVsPrevious >= 0 ? "+" : ""}
            {featured.rateDeltaVsPrevious} vs last month
          </span>
        </div>
      ) : null}
      <p className="ma-side-quests__read">
        {sideQuests.coachRead}
        <small>{sideQuests.footnote}</small>
      </p>
    </section>
  );
}

export function MonthlyAnalyticsBody({ model }: { model: MonthlyAnalyticsModel }) {
  return (
    <>
      <div className="ma-hero-row">
        <MonthlyEngineHero engine={model.engine} />
        <aside className="ma-right-rail" aria-label="VO₂ and sleep">
          <MonthlyVo2Card vo2={model.vo2} />
          <MonthlySleepCard monthLabel={model.sleep.monthLabel} />
        </aside>
      </div>
      <div className="ma-breakdown-row">
        <WorkoutBreakdownCard breakdown={model.breakdown} />
        <SideQuestsCard sideQuests={model.sideQuests} />
      </div>
    </>
  );
}
