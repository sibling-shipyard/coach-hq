import { useCallback, useEffect, useState } from "react";
import { RecentSessionsCard } from "@/components/home-warm/WarmInstrumentWidgets";
import { GOLDEN_HOME } from "@/lib/goldenDataset";
import { GitHubAuthButton } from "@/components/login/GitHubAuthButton";
import { WelcomeEngineHero } from "./WelcomeEngineHero";
import { WelcomeInviteCta } from "./WelcomeInviteCta";
import { WelcomeTimerDemo } from "./WelcomeTimerDemo";
import { WelcomeAdaptDemo } from "./WelcomeAdaptDemo";
import { WelcomeCoachVoice } from "./WelcomeCoachVoice";
import { WelcomeHighlightsCarousel } from "./WelcomeHighlightsCarousel";
import { WelcomePhilosophy } from "./WelcomePhilosophy";
import { useWelcomeAnimations } from "./useWelcomeAnimations";
import "@/components/home-warm/warm-instrument.css";
import "./welcome.css";

const SECTION_LINKS = [
  { href: "#does", label: "WHAT IT DOES" },
  { href: "#highlights", label: "HIGHLIGHTS" },
  { href: "#coach", label: "THE COACH" },
] as const;

export function WelcomePage() {
  const rootRef = useWelcomeAnimations();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen, closeMenu]);

  return (
    <div className="wi-shell welcome-page" ref={rootRef}>
      <header className="welcome-nav">
        <div className="welcome-nav__inner">
          <span className="welcome-nav__brand">COACH PHELPS</span>
          <span className="welcome-nav__beta">PRIVATE BETA</span>
          <button
            type="button"
            className="welcome-nav__toggle"
            aria-expanded={menuOpen}
            aria-controls="welcome-nav-sections"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">{menuOpen ? "Close section menu" : "Open section menu"}</span>
            <span className="welcome-nav__toggle-bar" aria-hidden="true" />
            <span className="welcome-nav__toggle-bar" aria-hidden="true" />
            <span className="welcome-nav__toggle-bar" aria-hidden="true" />
          </button>
          <nav className="welcome-nav__links" aria-label="Page sections">
            <div
              id="welcome-nav-sections"
              className={`welcome-nav__sections${menuOpen ? " is-open" : ""}`}
            >
              {SECTION_LINKS.map(({ href, label }) => (
                <a key={href} href={href} onClick={closeMenu}>
                  {label}
                </a>
              ))}
            </div>
            <div className="welcome-nav__actions">
              <GitHubAuthButton className="welcome-nav__cta welcome-nav__cta--ghost">
                LOG IN
              </GitHubAuthButton>
              <a href="#invite" className="welcome-nav__cta">
                JOIN THE WAITLIST
              </a>
            </div>
          </nav>
        </div>
      </header>

      <section className="welcome-hero">
        <div className="welcome-hero__inner">
          <div className="welcome-hero__copy" data-reveal>
            <span className="welcome-kicker">AI PERSONAL TRAINER</span>
            <h1 className="welcome-hero__title">Everyone deserves someone in their corner.</h1>
            <p className="welcome-hero__lede">
              A coach that remembers you — your history, your injuries, your wins, what worked last
              week. Undeniably focused on one thing: watching you get better.
            </p>
            <div className="welcome-hero__actions">
              <a href="#invite" className="welcome-btn welcome-btn--primary">
                Get early access
              </a>
              <a href="#highlights" className="welcome-btn welcome-btn--ghost">
                See the widgets ↓
              </a>
            </div>
            <div className="welcome-hero__platforms welcome-hero__platforms--single">
              <span className="welcome-hero__platforms-dot" aria-hidden="true" />
              <span>WORKS WITH WHAT YOU ALREADY WEAR · APPLE HEALTH · NO NEW DEVICE</span>
            </div>
          </div>
          <div data-reveal>
            <WelcomeEngineHero engine={GOLDEN_HOME.engine} />
          </div>
        </div>
      </section>

      <section className="welcome-section welcome-section--paper" id="does">
        <div className="welcome-section__intro welcome-section__intro--compact" data-reveal>
          <span className="welcome-kicker">WHAT COACH DOES</span>
          <h2 className="welcome-section__title">
            Anybody can hand you a workout. This one remembers you.
          </h2>
        </div>

        <div className="welcome-feature">
          <div className="welcome-feature__copy" data-reveal>
            <span className="welcome-feature__index">01 · IT READS EVERYTHING</span>
            <h3>It reads what you already do — no manual logging.</h3>
            <p>
              Coach pulls sessions straight from Apple Health, reads your match scores, and watches
              heart-rate trends. Every figure on the page is earned from real activity — nothing
              invented.
            </p>
          </div>
          <div className="welcome-feature__card welcome-feature__card--wi">
            <RecentSessionsCard sessions={GOLDEN_HOME.sessions} staggerRows />
          </div>
        </div>

        <div className="welcome-feature welcome-feature--reverse">
          <div className="welcome-feature__copy" data-reveal>
            <span className="welcome-feature__index">02 · IT REMEMBERS</span>
            <h3>The patterns you&apos;re too close to notice.</h3>
            <p>
              Your left-knee history. The goal you set in January. The habit of skipping strength when
              matches get busy. It watches patterns across months, not just today.
            </p>
          </div>
          <div className="welcome-feature__card welcome-feature__card--coach" data-reveal>
            <span className="welcome-feature__card-label">COACH REMEMBERS</span>
            <div className="welcome-memory-tags">
              <span className="welcome-memory-tags__alarm">⚠ LEFT KNEE · 2023 MENISCUS</span>
              <span>GOAL · FULL FRONT LEVER</span>
              <span>HABIT · SKIPS STRENGTH IN SEASON</span>
            </div>
            <blockquote>
              &ldquo;You told me the knee flares on back-to-back match days. I moved your bar session
              to Wednesday — give it the gap.&rdquo;
            </blockquote>
          </div>
        </div>

        <WelcomeAdaptDemo />
      </section>

      <WelcomeHighlightsCarousel />

      <WelcomeCoachVoice />

      <section className="welcome-section welcome-section--paper">
        <div className="welcome-section__intro welcome-section__intro--compact" data-reveal>
          <span className="welcome-kicker">WHEN IT&apos;S TIME TO MOVE</span>
          <h2 className="welcome-section__title">The plan becomes a follow-along.</h2>
          <p className="welcome-section__lede">
            Every workout Coach writes runs as a live timer — on your desk or in your hand. Big
            countdown, the form cue that matters, and why you&apos;re doing it. It&apos;s counting down
            right now.
          </p>
        </div>
        <WelcomeTimerDemo />
      </section>

      <WelcomePhilosophy />

      <WelcomeInviteCta />
    </div>
  );
}
