import { useState } from "react";
import { COACH_CARDS } from "./welcomeCopy";

export function WelcomeCoachVoice() {
  const [active, setActive] = useState(0);
  const card = COACH_CARDS[active];

  return (
    <section className="welcome-section welcome-section--dark welcome-coach-voice" id="coach">
      <div className="welcome-coach-voice__inner">
        <span
          className="welcome-kicker welcome-kicker--dark welcome-coach-voice__kicker"
          data-reveal
        >
          THE COACH
        </span>

        <div
          className="welcome-coach-voice__stage"
          data-reveal
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="welcome-coach-voice__quote" key={active}>
            <blockquote>&ldquo;{card.quote}&rdquo;</blockquote>
          </div>
        </div>

        <div
          className="welcome-coach-voice__picker"
          data-reveal
          role="tablist"
          aria-label="Coach voice contexts"
        >
          {COACH_CARDS.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="tab"
              aria-selected={active === index}
              className={`welcome-coach-voice__pill ${active === index ? "is-active" : ""}`}
              onClick={() => setActive(index)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
