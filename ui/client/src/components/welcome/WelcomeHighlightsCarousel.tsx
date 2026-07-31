import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  BuildPhaseCard,
  QuestCard,
  TrainingActivityCard,
  WeeklyPlanCard,
} from "@/components/home-warm/WarmInstrumentWidgets";
import { AmIImprovingCard } from "@/components/sport-analytics/BadmintonLensWidgets";
import { GOLDEN_HOME } from "@/lib/goldenDataset";
import "@/components/sport-analytics/sport-analytics.css";

const HIGHLIGHT_COUNT = 5;
const RAIL_GAP = 28;

function scrollTargetForIndex(
  rail: HTMLDivElement,
  index: number,
  cardWidth: number,
  cardPitch: number,
): number {
  const maxScroll = rail.scrollWidth - rail.clientWidth;
  const centerOffset = (rail.clientWidth - cardWidth) / 2;
  return Math.min(maxScroll, Math.max(0, index * cardPitch - centerOffset));
}

function indexFromScrollLeft(
  scrollLeft: number,
  clientWidth: number,
  cardWidth: number,
  cardPitch: number,
): number {
  const centerOffset = (clientWidth - cardWidth) / 2;
  return Math.min(
    HIGHLIGHT_COUNT - 1,
    Math.max(0, Math.round((scrollLeft + centerOffset) / cardPitch)),
  );
}

const SLIDE_LABELS = [
  "Skill progression",
  "Weekly planning",
  "Am I improving?",
  "Quests and sub-quests",
  "Consistency",
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function useCardPitch(railRef: RefObject<HTMLDivElement | null>) {
  const [pitch, setPitch] = useState(1118);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      const firstCard = rail.querySelector<HTMLElement>(".welcome-hl-card");
      if (firstCard) {
        setPitch(firstCard.offsetWidth + RAIL_GAP);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    const firstCard = rail.querySelector(".welcome-hl-card");
    if (firstCard) observer.observe(firstCard);

    return () => observer.disconnect();
  }, [railRef]);

  return pitch;
}

export function WelcomeHighlightsCarousel() {
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const animatingRef = useRef(false);
  const scrollTimerRef = useRef<number>();
  const rafRef = useRef<number>();
  const reducedMotion = useReducedMotion();
  const cardPitch = useCardPitch(railRef);

  const goTo = useCallback(
    (index: number) => {
      const rail = railRef.current;
      if (!rail || cardPitch <= RAIL_GAP) return;
      const cardWidth = cardPitch - RAIL_GAP;
      const clamped = Math.min(HIGHLIGHT_COUNT - 1, Math.max(0, index));
      const target = scrollTargetForIndex(rail, clamped, cardWidth, cardPitch);
      setActive(clamped);

      if (reducedMotion) {
        rail.scrollLeft = target;
        return;
      }

      animatingRef.current = true;
      const from = rail.scrollLeft;
      const dist = target - from;
      if (Math.abs(dist) < 1) {
        animatingRef.current = false;
        return;
      }
      const start = performance.now();
      const duration = 440;
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        rail.scrollLeft = from + dist * eased;
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          animatingRef.current = false;
          rafRef.current = undefined;
        }
      };
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(step);
    },
    [cardPitch, reducedMotion],
  );

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const onScroll = () => {
      if (animatingRef.current || cardPitch <= 0) return;
      window.clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = window.setTimeout(() => {
        const cardWidth = cardPitch - RAIL_GAP;
        const idx = indexFromScrollLeft(
          rail.scrollLeft,
          rail.clientWidth,
          cardWidth,
          cardPitch,
        );
        setActive((prev) => (prev === idx ? prev : idx));
      }, 120);
    };

    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      rail.removeEventListener("scroll", onScroll);
      window.clearTimeout(scrollTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [cardPitch]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || cardPitch <= RAIL_GAP) return;
    const cardWidth = cardPitch - RAIL_GAP;
    rail.scrollLeft = scrollTargetForIndex(rail, 0, cardWidth, cardPitch);
  }, [cardPitch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(active - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(active + 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, goTo]);

  return (
    <section className="welcome-highlights" id="highlights">
      <div className="welcome-section__intro welcome-highlights__intro" data-reveal>
        <span className="welcome-kicker">LIVE WIDGETS</span>
        <h2 className="welcome-section__title">Get the highlights.</h2>
      </div>

      <div className="welcome-highlights__stage">
        <div className="welcome-highlights__rail" ref={railRef}>
          {/* HL 1 · Skill progression */}
          <article className="welcome-hl-card">
            <div className="welcome-hl-card__copy">
              <span className="welcome-hl-card__tag">SKILL PROGRESSION</span>
              <p>
                <strong>Big skills become a phased challenge.</strong> Build blocks, a deload, then a
                test week — and every skill gets a milestone number, read straight from your challenge
                record.
              </p>
            </div>
            <div className="welcome-hl-card__widget welcome-hl-card__widget--wi">
              <BuildPhaseCard phase={GOLDEN_HOME.phase} />
            </div>
          </article>

          {/* HL 2 · Weekly planning */}
          <article className="welcome-hl-card">
            <div className="welcome-hl-card__copy">
              <span className="welcome-hl-card__tag">WEEKLY PLANNING</span>
              <p>
                <strong>The week is planned backwards from your goals</strong> — not forwards from a
                template. Match Saturday, so Thursday peaks and Wednesday rests. Miss a day and it
                re-plans; the goal stays.
              </p>
              <span className="welcome-hl-card__hint">HOVER A DAY</span>
            </div>
            <div className="welcome-hl-card__widget welcome-hl-card__widget--wi">
              <WeeklyPlanCard plan={GOLDEN_HOME.plan} />
            </div>
          </article>

          {/* HL 3 · Am I improving */}
          <article className="welcome-hl-card welcome-hl-card--dark">
            <div className="welcome-hl-card__copy">
              <span className="welcome-hl-card__tag welcome-hl-card__tag--amber">AM I IMPROVING?</span>
              <p>
                <strong>One honest answer, not twelve charts.</strong> Coach compares your last 8 weeks
                to your last 52 — and says it straight: better, flat, or slipping.
              </p>
            </div>
            <div className="welcome-hl-card__widget welcome-hl-card__widget--wi welcome-hl-card__widget--light">
              <AmIImprovingCard improving={GOLDEN_HOME.amIImproving} />
            </div>
          </article>

          {/* HL 4 · Quests */}
          <article className="welcome-hl-card">
            <div className="welcome-hl-card__copy">
              <span className="welcome-hl-card__tag">QUESTS &amp; SUB-QUESTS</span>
              <p>
                <strong>The big goal becomes this week&apos;s numbers.</strong> A main quest with a
                deadline, side quests for the head work — honest progress bars, so a scary goal turns
                into a Tuesday.
              </p>
            </div>
            <div className="welcome-hl-card__widget welcome-hl-card__widget--wi">
              <QuestCard quest={GOLDEN_HOME.quest} />
            </div>
          </article>

          {/* HL 5 · Consistency */}
          <article className="welcome-hl-card">
            <div className="welcome-hl-card__copy">
              <span className="welcome-hl-card__tag">CONSISTENCY</span>
              <p>
                <strong>Nothing dramatic. Just {GOLDEN_HOME.trainingActivity.activeDays} days.</strong> Every
                square is a day you showed up. That&apos;s the whole method — 1% today, 1% tomorrow.
                Not a countdown, not a program you finish.
              </p>
            </div>
            <div className="welcome-hl-card__widget welcome-hl-card__widget--wi welcome-hl-card__widget--consistency">
              <TrainingActivityCard
                activity={GOLDEN_HOME.trainingActivity}
                compact
                staggerCells
              />
            </div>
          </article>
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        Highlight {active + 1} of {HIGHLIGHT_COUNT}: {SLIDE_LABELS[active]}
      </p>

      <div className="welcome-highlights__controls">
        <button
          type="button"
          className="welcome-highlights__arrow welcome-highlights__arrow--prev"
          aria-label="Previous highlight"
          disabled={active === 0}
          onClick={() => goTo(active - 1)}
        >
          ‹
        </button>

        <div className="welcome-highlights__dots" role="tablist" aria-label="Highlight slides">
          {Array.from({ length: HIGHLIGHT_COUNT }, (_, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={active === index}
              aria-label={`Go to highlight ${index + 1}: ${SLIDE_LABELS[index]}`}
              className={`welcome-highlights__dot ${active === index ? "is-active" : ""}`}
              onClick={() => goTo(index)}
            />
          ))}
        </div>

        <button
          type="button"
          className="welcome-highlights__arrow welcome-highlights__arrow--next"
          aria-label="Next highlight"
          disabled={active === HIGHLIGHT_COUNT - 1}
          onClick={() => goTo(active + 1)}
        >
          ›
        </button>
      </div>
    </section>
  );
}
