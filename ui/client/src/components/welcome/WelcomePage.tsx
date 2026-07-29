import { SportCommitmentCard } from "@/components/home-warm/WarmInstrumentWidgets";
import { GOLDEN_HOME } from "@/lib/goldenDataset";
import { WelcomeEngineHero } from "./WelcomeEngineHero";
import { WelcomeInviteCta } from "./WelcomeInviteCta";
import { WelcomeTimerDemo } from "./WelcomeTimerDemo";
import { COACH_CARDS } from "./welcomeCopy";
import { useScrollReveal } from "./useScrollReveal";
import "@/components/home-warm/warm-instrument.css";
import "./welcome.css";

const FEATURE_SESSIONS = GOLDEN_HOME.sessions.map((session) => ({
  date: session.dateLabel,
  sport: session.sport as "badminton" | "cycling" | "calisthenics",
  title: session.title,
  meta: session.detail,
  load: session.load != null ? `+${session.load}` : "",
}));

function sportAccent(sport: "badminton" | "cycling" | "calisthenics") {
  if (sport === "badminton") return "#315a4a";
  if (sport === "cycling") return "#a8702c";
  return "#4f587a";
}

export function WelcomePage() {
  const rootRef = useScrollReveal();

  return (
    <div className="wi-shell welcome-page" ref={rootRef}>
      <header className="welcome-nav">
        <div className="welcome-nav__inner">
          <span className="welcome-nav__brand">COACH PHELPS</span>
          <span className="welcome-nav__beta">PRIVATE BETA</span>
          <nav className="welcome-nav__links" aria-label="Account">
            <a href="/api/auth/start" className="welcome-nav__cta">
              LOG IN WITH GITHUB
            </a>
          </nav>
        </div>
      </header>

      <section className="welcome-hero">
        <div className="welcome-hero__inner">
          <div className="welcome-hero__copy" data-reveal>
            <span className="welcome-kicker">AI PERSONAL TRAINER</span>
            <h1 className="welcome-hero__title">Train the process. The outcome follows.</h1>
            <p className="welcome-hero__lede">
              A coach that reads your training, your match scores, your heart-rate trends — and remembers
              your injuries, your goals, your bad habits. Then builds the week around them.
            </p>
            <div className="welcome-hero__actions">
              <a href="#invite" className="welcome-btn welcome-btn--primary">
                Get early access
              </a>
              <a href="#widgets" className="welcome-btn welcome-btn--ghost">
                See the widgets ↓
              </a>
            </div>
            <div className="welcome-hero__platforms">
              <span>WEB HQ</span>
              <span>iOS APP</span>
              <span>HOME WIDGETS</span>
              <span>FOLLOW-ALONG</span>
            </div>
          </div>
          <div data-reveal>
            <WelcomeEngineHero engine={GOLDEN_HOME.engine} />
          </div>
        </div>
      </section>

      <section className="welcome-section welcome-section--paper" id="features">
        <div className="welcome-section__intro" data-reveal>
          <span className="welcome-kicker">WHAT COACH DOES</span>
          <h2 className="welcome-section__title">Not a tracker. A coach that actually knows you.</h2>
        </div>

        <div className="welcome-feature">
          <div className="welcome-feature__copy" data-reveal>
            <span className="welcome-feature__index">01 · IT READS EVERYTHING</span>
            <h3>It reads what you already do — no manual logging.</h3>
            <p>
              Coach pulls sessions straight from Apple Health, reads your match scores, and watches
              heart-rate trends. Every figure on the page is earned from real activity — nothing invented.
            </p>
          </div>
          <div className="welcome-feature__card" data-reveal>
            <span className="welcome-feature__card-label">AUTO-IMPORTED · THIS WEEK</span>
            {FEATURE_SESSIONS.map((session, index) => (
              <div
                key={session.date}
                className={`welcome-session-row ${index < FEATURE_SESSIONS.length - 1 ? "has-border" : ""}`}
              >
                <span className="welcome-session-row__date">{session.date}</span>
                <span
                  className="welcome-session-row__bar"
                  style={{ background: sportAccent(session.sport) }}
                />
                <span className="welcome-session-row__title">{session.title}</span>
                <span className="welcome-session-row__meta">{session.meta}</span>
                <span
                  className="welcome-session-row__load"
                  style={{ color: sportAccent(session.sport) }}
                >
                  {session.load}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="welcome-feature welcome-feature--reverse">
          <div className="welcome-feature__copy" data-reveal>
            <span className="welcome-feature__index">02 · IT REMEMBERS</span>
            <h3>It remembers what you&apos;d rather forget.</h3>
            <p>
              Your left-knee history. The goal you set in January. The habit of skipping strength when
              matches get busy. Coach holds all of it, and gently brings it up when it matters.
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
              &ldquo;You told me the knee flares on back-to-back match days. I moved your bar session to
              Wednesday — give it the gap.&rdquo;
            </blockquote>
            <span className="welcome-memory-sign">— PHELPS</span>
          </div>
        </div>

        <div className="welcome-feature welcome-feature--last">
          <div className="welcome-feature__copy" data-reveal>
            <span className="welcome-feature__index">03 · IT ADAPTS</span>
            <h3>Sore? It bends the plan, not your body.</h3>
            <p>
              Tell Coach you&apos;re beat up and the week reshapes in seconds — intensity drops, mobility
              slots in, the projection recomputes. Big goals get broken into sub-goals you can actually
              keep.
            </p>
          </div>
          <div className="welcome-feature__card" data-reveal>
            <div className="welcome-quest">
              <div className="welcome-quest__head">
                <span className="welcome-feature__card-label">MAIN QUEST</span>
                <span className="welcome-quest__countdown">4D LEFT</span>
              </div>
              <div className="welcome-quest__row">
                <span className="welcome-quest__title">Weekly structured sessions</span>
                <span className="welcome-quest__value">
                  1.5<span>/ 2.5</span>
                </span>
              </div>
              <div className="welcome-quest__bar welcome-quest__bar--main">
                <span style={{ width: "60%" }} />
              </div>
              <div className="welcome-quest__subs">
                <div>
                  <div className="welcome-quest__sub-row">
                    <span>Front lever · single-leg → full</span>
                    <span className="welcome-quest__sub-meta">9S → 5S</span>
                  </div>
                  <div className="welcome-quest__bar welcome-quest__bar--cal">
                    <span style={{ width: "55%" }} />
                  </div>
                </div>
                <div>
                  <div className="welcome-quest__sub-row">
                    <span>Mobility (added — you&apos;re sore)</span>
                    <span className="welcome-quest__sub-meta welcome-quest__sub-meta--new">NEW</span>
                  </div>
                  <div className="welcome-quest__bar welcome-quest__bar--fdn">
                    <span style={{ width: "20%" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="welcome-section" id="widgets">
        <div className="welcome-section__intro" data-reveal>
          <span className="welcome-kicker">LIVE WIDGETS · TRY THEM</span>
          <h2 className="welcome-section__title">The same instruments, on every surface.</h2>
          <p className="welcome-section__lede">
            Warm paper, one terracotta accent for load, monospace for anything counted. These are real
            and interactive — hover, toggle, scrub.
          </p>
        </div>

        <div className="welcome-widgets-grid">
          <div className="welcome-widgets-card" data-reveal>
            <div className="welcome-widgets-card__head">
              <span className="welcome-feature__card-label">SPORT COMMITMENTS</span>
              <span className="welcome-widgets-card__hint">CLICK BADMINTON ⇄</span>
            </div>
            <div className="welcome-commitments">
              {GOLDEN_HOME.commitments.map((item) => (
                <SportCommitmentCard key={item.id} item={item} />
              ))}
            </div>
          </div>

          <div className="welcome-phone" data-reveal>
            <div className="welcome-phone__screen">
              <div className="welcome-phone__hq">
                <span className="welcome-phone__brand">HQ</span>
                <span className="welcome-phone__phase">BUILD · WK 4/4</span>
                <span className="welcome-phone__dot" aria-hidden="true" />
              </div>
              <div className="welcome-phone__engine">
                <span className="welcome-phone__engine-label">ENGINE</span>
                <span className="welcome-phone__engine-value">{GOLDEN_HOME.engine.load}</span>
                <span className="welcome-phone__engine-verdict">{GOLDEN_HOME.engine.compactVerdict}</span>
                <div className="welcome-phone__engine-mix">
                  <span style={{ width: "41%" }} />
                  <span style={{ width: "27%" }} />
                  <span style={{ width: "6%" }} />
                  <span />
                </div>
              </div>
              <div className="welcome-phone__duo">
                <div className="welcome-phone__mini">
                  <span>CALORIES</span>
                  <strong>5.3K</strong>
                  <div className="welcome-phone__mini-bar">
                    <span style={{ width: "44%" }} />
                  </div>
                </div>
                <div className="welcome-phone__mini">
                  <span>VO2 MAX</span>
                  <strong>46.2</strong>
                  <em>▲ 2.1 · TOP 15%</em>
                </div>
              </div>
              <div className="welcome-phone__read">
                One loaded session before Sunday keeps Block 1 honest.{" "}
                <span>— PHELPS</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="welcome-section welcome-section--paper">
        <div className="welcome-journey">
          <div className="welcome-journey__sticky" data-reveal>
            <span className="welcome-kicker">THE JOURNEY, RESHAPED</span>
            <h2 className="welcome-section__title welcome-section__title--sm">
              From guessing and grinding to a quiet, honest rhythm.
            </h2>
            <p>
              Coach doesn&apos;t gamify or shame. It shows you the band to stay inside, remembers the
              long game, and speaks like a mentor who&apos;s been there.
            </p>
          </div>
          <div className="welcome-journey__stack">
            <div className="welcome-journey-card" data-reveal>
              <span className="welcome-feature__card-label">BEFORE</span>
              <blockquote>
                &ldquo;Did I do enough? Should I push harder? Why did I skip again?&rdquo;
              </blockquote>
            </div>
            <div className="welcome-journey-card welcome-journey-card--accent" data-reveal>
              <span className="welcome-feature__card-label">WITH COACH</span>
              <blockquote>
                &ldquo;You&apos;re in the band. One loaded session keeps the block honest — then we deload
                and test. That&apos;s it for today.&rdquo;
              </blockquote>
            </div>
            <div className="welcome-journey-stats" data-reveal>
              <div>
                <strong>18D</strong>
                <span>LONGEST BLOCK</span>
              </div>
              <div>
                <strong>82%</strong>
                <span>PLAN-TRUE</span>
              </div>
              <div>
                <strong className="is-bdm">46.2</strong>
                <span>VO2 · ▲ 2.1</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="welcome-section">
        <div className="welcome-section__intro" data-reveal>
          <span className="welcome-kicker">WHEN IT&apos;S TIME TO MOVE</span>
          <h2 className="welcome-section__title">The plan becomes a follow-along.</h2>
          <p className="welcome-section__lede">
            Every workout Coach writes runs as a live timer — on your desk or in your hand. Big countdown,
            the form cue that matters, and why you&apos;re doing it. It&apos;s counting down right now.
          </p>
        </div>
        <WelcomeTimerDemo />
      </section>

      <section className="welcome-section welcome-section--dark" id="coach">
        <div className="welcome-coach__intro" data-reveal>
          <span className="welcome-kicker welcome-kicker--dark">THE VOICE BEHIND IT</span>
          <h2 className="welcome-coach__title">
            Coach Phelps talks like a mentor who&apos;s been in the arena — process-focused, honest about
            the hard days, never a drill sergeant.
          </h2>
        </div>
        <div className="welcome-coach__grid">
          {COACH_CARDS.map((card) => (
            <article key={card.label} className="welcome-coach-card" data-reveal>
              <span className="welcome-coach-card__label">{card.label}</span>
              <blockquote>&ldquo;{card.quote}&rdquo;</blockquote>
            </article>
          ))}
        </div>
      </section>

      <WelcomeInviteCta />
    </div>
  );
}
