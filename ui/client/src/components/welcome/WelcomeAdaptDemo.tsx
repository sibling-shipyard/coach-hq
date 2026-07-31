import { useState } from "react";

const SCENARIOS = [
  {
    label: "Fresh & ready for today's workout",
    badge: "PLAN HELD",
    title: "Tempo squat · 5 sets",
    meta: "52 MIN · FULL LOAD",
    pct: 88,
    chips: ["TEMPO 3-1-1", "+ SPLIT SQUAT", "BAR FINISHER"],
    voice:
      "Good — take it. Days like this are where the block gets built, so don't waste it being clever. Full load, clean reps.",
  },
  {
    label: "Feeling soreness in hamstrings from badminton yesterday",
    badge: "PLAN RESHAPED",
    title: "Upper pull + hamstring flush",
    meta: "36 MIN · NOTHING LOADED BELOW THE HIP",
    pct: 30,
    chips: ["HAMSTRINGS OFF-DUTY", "MOBILITY 12 MIN", "PROJECTION RECOMPUTED"],
    voice:
      "Badminton took the hamstrings — loading them today buys nothing. We pull, we flush, and the squat moves, not the goal.",
  },
] as const;

export function WelcomeAdaptDemo() {
  const [active, setActive] = useState(0);
  const plan = SCENARIOS[active];

  return (
    <div className="welcome-feature welcome-feature--last">
      <div className="welcome-feature__copy" data-reveal>
        <span className="welcome-feature__index">03 · IT ADAPTS</span>
        <h3>Sore? It bends the plan, not your body.</h3>
        <p>
          Tired, sore, life got in the way? Tell coach and the week reshapes in seconds — intensity
          drops, mobility slots in, the projection recomputes. Big goals get broken into sub-goals you
          can actually keep.
        </p>
        <div className="welcome-adapt__scenarios">
          {SCENARIOS.map((scenario, index) => (
            <button
              key={scenario.label}
              type="button"
              className={`welcome-adapt__scenario ${active === index ? "is-active" : ""}`}
              onClick={() => setActive(index)}
            >
              <span className="welcome-adapt__scenario-head">
                <span>{index === 0 ? "A · TODAY" : "B · TODAY"}</span>
                {active === index ? <span aria-hidden="true">✓</span> : null}
              </span>
              <span className="welcome-adapt__scenario-label">{scenario.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="welcome-adapt__plan welcome-feature__card" data-reveal>
        <div className="welcome-adapt__plan-head">
          <span className="welcome-feature__card-label">TODAY · RESHAPED</span>
          <span className="welcome-adapt__plan-badge">{plan.badge}</span>
        </div>
        <div className="welcome-adapt__plan-body" key={active}>
          <div className="welcome-adapt__plan-title-block">
            <div className="welcome-adapt__plan-title">{plan.title}</div>
            <div className="welcome-adapt__plan-meta">{plan.meta}</div>
          </div>
          <div>
            <div className="welcome-adapt__intensity-head">
              <span>INTENSITY</span>
              <span>{plan.pct}%</span>
            </div>
            <div className="welcome-adapt__intensity-bar">
              <span style={{ width: `${plan.pct}%` }} />
            </div>
          </div>
          <div className="welcome-adapt__chips">
            {plan.chips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
          <blockquote className="welcome-adapt__voice">&ldquo;{plan.voice}&rdquo;</blockquote>
        </div>
      </div>
    </div>
  );
}
