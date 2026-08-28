import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityGlyph } from "../ActivityGlyph";
import { clamp } from "../formatUtils";
import type { PlanDaySnapshot, WeeklyPlanSnapshot } from "../snapshots";

type PlanAssignment = Pick<
  PlanDaySnapshot,
  "activities" | "glyph" | "href" | "isRecorded" | "loadDelta" | "sport" | "title"
>;

function assignmentFromDay(day: PlanDaySnapshot): PlanAssignment {
  return {
    activities: day.activities,
    glyph: day.glyph,
    href: day.href,
    isRecorded: day.isRecorded,
    loadDelta: day.loadDelta,
    sport: day.sport,
    title: day.title,
  };
}

function swapPlanAssignments(current: PlanAssignment[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex) return current;
  const next = [...current];
  [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
  return next;
}

export function WeeklyPlanCard({ plan }: { plan: WeeklyPlanSnapshot }) {
  const instructionsId = useId();
  const slotsRef = useRef<Array<HTMLDivElement | null>>([]);
  const dragFromRef = useRef<number | null>(null);
  const [assignments, setAssignments] = useState<PlanAssignment[]>(() =>
    plan.days.map(assignmentFromDay),
  );
  const [grabbedIndex, setGrabbedIndex] = useState<number | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    setAssignments(plan.days.map(assignmentFromDay));
    setGrabbedIndex(null);
    dragFromRef.current = null;
  }, [plan]);

  const projection = useMemo(() => {
    const knownLoads = assignments
      .map((assignment) => assignment.loadDelta)
      .filter((load): load is number => load !== null);
    if (knownLoads.length === 0) {
      return { label: "Projection unavailable", state: "is-unavailable" };
    }

    const total = knownLoads.reduce((sum, load) => sum + load, 0);
    if (plan.bandLow === null || plan.bandHigh === null) {
      return { label: `Projected ≈${total} — band unavailable.`, state: "is-neutral" };
    }
    if (total > plan.bandHigh) {
      return { label: `Projected ≈${total} — over the band. Ease off.`, state: "is-alert" };
    }
    if (total < plan.bandLow) {
      return { label: `Projected ≈${total} — below the band.`, state: "is-neutral" };
    }
    const upperThreshold = plan.bandLow + (plan.bandHigh - plan.bandLow) * 0.7;
    return total > upperThreshold
      ? { label: `Projected ≈${total} — upper band.`, state: "is-neutral" }
      : { label: `Projected ≈${total} — in the band.`, state: "is-neutral" };
  }, [assignments, plan.bandHigh, plan.bandLow]);

  function moveAssignment(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || !assignments[fromIndex]?.glyph) return;
    const movedTitle = assignments[fromIndex].title;
    setAssignments((current) => swapPlanAssignments(current, fromIndex, toIndex));
    setStatus(`${movedTitle} moved to ${plan.days[toIndex].day}.`);
  }

  function handleDragStart(event: ReactDragEvent<HTMLDivElement>, index: number) {
    if (!assignments[index]?.glyph) {
      event.preventDefault();
      return;
    }
    dragFromRef.current = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    event.currentTarget.classList.add("is-dragging");
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>, index: number) {
    event.preventDefault();
    const fromIndex = dragFromRef.current;
    if (fromIndex !== null) moveAssignment(fromIndex, index);
    dragFromRef.current = null;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, index: number) {
    if (event.key === "Escape" && grabbedIndex !== null) {
      event.preventDefault();
      setGrabbedIndex(null);
      setStatus("Plan move cancelled.");
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const nextIndex = clamp(index + direction, 0, plan.days.length - 1);
      slotsRef.current[nextIndex]?.focus();
      return;
    }
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (grabbedIndex === null) {
      if (!assignments[index]?.glyph) return;
      setGrabbedIndex(index);
      setStatus(
        `${assignments[index].title} picked up. Choose a day and press Enter or Space to drop.`,
      );
      return;
    }
    moveAssignment(grabbedIndex, index);
    setGrabbedIndex(null);
  }

  return (
    <section className="wi-plan-card">
      <div className="wi-card-kicker">
        <span>{plan.title ?? "WEEKLY PLAN"}</span>
        <b>{plan.statusLabel ?? (plan.isPreview ? "COACH DRAFT" : plan.label)}</b>
      </div>
      <div className="wi-plan-card__days" role="list">
        {plan.days.map((day, index) => {
          const assignment = assignments[index] ?? assignmentFromDay(day);
          const isGrabbed = grabbedIndex === index;
          return (
            <div className="wi-plan-day" key={day.key} role="listitem">
              <span className="wi-plan-day__label">
                <span className="wi-desktop-only">{day.dayShort}</span>
                <span className="wi-mobile-only">{day.dayShort.slice(0, 1)}</span>
              </span>
              <div
                aria-describedby={instructionsId}
                aria-label={`${day.day}: ${assignment.glyph ? assignment.title : "empty drop target"}`}
                aria-pressed={isGrabbed}
                className={`wi-plan-day__slot is-${assignment.sport} ${isGrabbed ? "is-grabbed" : ""}`.trim()}
                draggable={Boolean(assignment.glyph)}
                onDragEnd={(event) => {
                  event.currentTarget.classList.remove("is-dragging");
                  dragFromRef.current = null;
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDragStart={(event) => handleDragStart(event, index)}
                onDrop={(event) => handleDrop(event, index)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                ref={(element) => {
                  slotsRef.current[index] = element;
                }}
                role="button"
                tabIndex={0}
                title={
                  assignment.glyph
                    ? `${assignment.title} — drag to move`
                    : `Move a session to ${day.day}`
                }
              >
                {assignment.glyph ? (
                  <ActivityGlyph kind={assignment.glyph} size={15} />
                ) : (
                  <span>REST</span>
                )}
                {assignment.loadDelta !== null ? <small>+{assignment.loadDelta}</small> : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className={`wi-plan-card__projection ${projection.state}`} aria-live="polite">
        {projection.label}
      </p>
      <span className="sr-only" id={instructionsId}>
        Press Enter or Space to pick up a session, use the left and right arrows to choose a day,
        then press Enter or Space to drop. Press Escape to cancel.
      </span>
      <span className="sr-only" aria-live="assertive">
        {status}
      </span>
    </section>
  );
}
