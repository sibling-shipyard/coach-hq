import { useEffect, useRef, useState } from "react";

const TOTAL_SECONDS = 45;
const INITIAL_SECONDS = 32;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return reduced;
}

export function WelcomeTimerDemo() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(INITIAL_SECONDS);
  const [running, setRunning] = useState(false);
  const [inView, setInView] = useState(false);
  const [enterPulse, setEnterPulse] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const root = gridRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
      },
      { threshold: 0.35 },
    );

    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || prefersReducedMotion) {
      setRunning(false);
      return;
    }
    setRunning(true);
    setEnterPulse(true);
    const pulseTimer = window.setTimeout(() => setEnterPulse(false), 900);
    return () => window.clearTimeout(pulseTimer);
  }, [inView, prefersReducedMotion]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => (value > 0 ? value - 1 : TOTAL_SECONDS));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const progress = Math.round(((TOTAL_SECONDS - remaining) / TOTAL_SECONDS) * 100);
  const timeStr = `0:${String(remaining).padStart(2, "0")}`;
  const runLabel = running ? "❚❚  Pause" : "▶  Resume";
  const enterPulseClass = enterPulse ? " is-enter-pulse" : "";

  return (
    <div className="welcome-timer-grid" ref={gridRef}>
      <div className="welcome-timer-card" data-reveal>
        <div className="welcome-timer-card__head">
          <span className="welcome-timer-card__set">SET 3 / 5 · TEMPO</span>
          <span className="welcome-timer-card__sport">CALISTHENICS · LOWER</span>
          <span
            className={`welcome-timer-card__pulse${running ? " is-live" : ""}`}
            aria-hidden="true"
          />
        </div>
        <div className="welcome-timer-card__main">
          <div className={`welcome-timer-card__time${enterPulseClass}`}>{timeStr}</div>
          <div className="welcome-timer-card__exercise">
            <div className="welcome-timer-card__name">Tempo goblet squat</div>
            <div className="welcome-timer-card__cue">3s DOWN · 1s HOLD · DRIVE UP</div>
          </div>
        </div>
        <div className="welcome-timer-card__bar">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="welcome-timer-card__panels">
          <div className="welcome-timer-card__panel">
            <span className="welcome-timer-card__panel-label">FORM CUE</span>
            <p>Knees track over toes. Chest tall through the hold.</p>
          </div>
          <div className="welcome-timer-card__panel welcome-timer-card__panel--coach">
            <span className="welcome-timer-card__panel-label">WHY · COACH</span>
            <p>The tempo protects that knee. Slow is the point.</p>
          </div>
        </div>
        <div className="welcome-timer-card__controls">
          <span className="welcome-timer-card__nav">⏮ PREV</span>
          <button
            type="button"
            className="welcome-timer-card__run"
            onClick={() => setRunning((v) => !v)}
          >
            {runLabel}
          </button>
          <span className="welcome-timer-card__nav welcome-timer-card__nav--next">NEXT ⏭</span>
        </div>
        <div className="welcome-timer-card__next">
          UP NEXT<span>· Bulgarian split squat</span>
          <span>· 8 REPS / SIDE</span>
        </div>
      </div>

      <div className="welcome-phone welcome-phone--timer" data-reveal>
        <div className="welcome-phone__screen welcome-phone__screen--timer">
          <div className="welcome-phone__timer-head">
            <span>SET 3/5</span>
            <span aria-hidden="true">♪</span>
          </div>
          <div className="welcome-phone__timer-body">
            <div className={`welcome-phone__timer-time${enterPulseClass}`}>{timeStr}</div>
            <div className="welcome-phone__timer-name">Tempo goblet squat</div>
            <div className="welcome-phone__timer-sub">3s DOWN · 1s HOLD</div>
            <div className="welcome-phone__timer-bar">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="welcome-phone__timer-coach">Slow is the point — protect the knee.</div>
          <button
            type="button"
            className="welcome-phone__timer-btn"
            onClick={() => setRunning((v) => !v)}
          >
            {runLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
