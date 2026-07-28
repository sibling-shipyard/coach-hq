import { useState, type FormEvent } from "react";

interface WelcomeInviteCtaProps {
  betaLabel?: string;
}

function SneakpeakIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20 L16.2 16.2" />
    </svg>
  );
}

export function WelcomeInviteCta({ betaLabel = "PRIVATE BETA" }: WelcomeInviteCtaProps) {
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSubmitted(true);
  }

  function handleSneakpeak() {
    document.getElementById("widgets")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <section className="welcome-cta" id="invite">
      <div className="welcome-cta__inner">
        <span className="welcome-kicker welcome-kicker--center">{betaLabel} · BY INVITE</span>
        <h2 className="welcome-cta__title">Come train with a coach that remembers.</h2>
        <p className="welcome-cta__lede">
          I&apos;m handing this to a few friends first. If you want in, grab a spot — I&apos;ll set up
          your HQ and we&apos;ll build your first block together.
        </p>

        {submitted ? (
          <div className="welcome-cta__success" role="status">
            <span className="welcome-cta__success-icon" aria-hidden="true">
              ✓
            </span>
            <div>
              <div className="welcome-cta__success-title">You&apos;re on the list.</div>
              <div className="welcome-cta__success-sub">We&apos;ll reach out at {email.trim()}</div>
            </div>
          </div>
        ) : (
          <div className={`welcome-cta__actions ${expanded ? "is-expanded" : ""}`}>
            <div className="welcome-cta__primary-slot">
              {expanded ? (
                <form className="welcome-cta__form" onSubmit={handleSubmit}>
                  <label className="sr-only" htmlFor="welcome-invite-email">
                    Email address
                  </label>
                  <input
                    id="welcome-invite-email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    placeholder="YOUR@EMAIL.COM"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="welcome-cta__input"
                  />
                  <button type="submit" className="welcome-cta__submit">
                    Send
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="welcome-cta__primary"
                  onClick={() => setExpanded(true)}
                >
                  Request my invite
                </button>
              )}
            </div>
            <button
              type="button"
              className="welcome-cta__peek"
              onClick={handleSneakpeak}
              aria-label="Sneakpeak — scroll to live widgets"
            >
              <span className="welcome-cta__peek-label">Sneakpeak</span>
              <span className="welcome-cta__peek-icon">
                <SneakpeakIcon />
              </span>
            </button>
          </div>
        )}

        <p className="welcome-cta__footer">
          COACH PHELPS · PROCESS OVER OUTCOME · MADE FOR ATHLETES WHO ARE DONE FIGHTING THEMSELVES
        </p>
      </div>
    </section>
  );
}
