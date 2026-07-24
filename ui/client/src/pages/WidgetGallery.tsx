import {
  BuildPhaseCard,
  CaloriesCard,
  CoachReadCard,
  EngineCard,
  InstrumentHeader,
  QuestCard,
  RecentSessionsCard,
  SportCommitmentCard,
  TrainingActivityCard,
  Vo2Card,
  WeeklyPlanCard,
} from "@/components/home-warm/WarmInstrumentWidgets";
import {
  GALLERY_CALORIES,
  GALLERY_COACH_READ,
  GALLERY_COMMITMENTS,
  GALLERY_ENGINE,
  GALLERY_PHASE,
  GALLERY_PLAN,
  GALLERY_QUEST,
  GALLERY_SESSIONS,
  GALLERY_TRAINING_ACTIVITY,
  GALLERY_VO2,
  GALLERY_VO2_EMPTY,
} from "@/components/home-warm/galleryFixtures";
import "@/components/home-warm/warm-instrument.css";
import "@/components/home-warm/widget-gallery.css";
import type { ReactNode } from "react";

interface GalleryAside {
  label: string;
  content: ReactNode;
}

interface GallerySectionProps {
  id: string;
  index: string;
  title: string;
  meaning: string;
  interaction?: ReactNode;
  asides?: GalleryAside[];
  children: ReactNode;
}

function GallerySection({ id, index, title, meaning, interaction, asides, children }: GallerySectionProps) {
  return (
    <section className="wg-section" id={id}>
      <div className="wg-section__meta">
        <span className="wg-section__kicker">{index} · {title}</span>
        <p className="wg-section__meaning">{meaning}</p>
        {interaction ? (
          <div className="wg-note">
            <span className="wg-note__label">INTERACTIONS · WEB</span>
            {interaction}
          </div>
        ) : null}
        {asides?.map((aside) => (
          <div className="wg-note wg-note--ios" key={aside.label}>
            <span className="wg-note__label">{aside.label}</span>
            {aside.content}
          </div>
        ))}
      </div>
      <div className="wg-section__body">{children}</div>
    </section>
  );
}

const SECTIONS = [
  { id: "engine", label: "00/01 · 08 · 10 — Engine, Quest, Coach's read" },
  { id: "commitments", label: "02 — Sport commitments" },
  { id: "plan", label: "04 · 07 — Weekly plan, Calories" },
  { id: "sessions", label: "05 · 11 — Recent sessions, Build phase" },
  { id: "heatmap", label: "06 · 09 — Training activity, VO2 max" },
];

export default function WidgetGallery() {
  return (
    <div className="wi-shell">
      <div className="wg-page">
        <InstrumentHeader
          currentRoute="/gallery"
          phaseLabel="WIDGET GALLERY · REFERENCE DATA, NOT LIVE"
          mobilePhaseLabel="WIDGET GALLERY"
          syncHealthy
          syncLabel="reference"
        />

        <div className="wg-intro">
          <span className="wg-intro__kicker">WARM INSTRUMENT · WIDGET GALLERY</span>
          <p className="wg-intro__lede">
            Every widget below is the real production component from Home, fed by fixture
            data instead of the repo's live feed. Hover, drag, and page through them —
            the interactions are the actual ones the athlete gets, not a mockup.
          </p>
          <nav aria-label="Widget sections" className="wg-toc">
            {SECTIONS.map((section) => (
              <a href={`#${section.id}`} key={section.id}>{section.label}</a>
            ))}
          </nav>
        </div>

        <GallerySection
          id="engine"
          index="00/01 · 08 · 10"
          title="ENGINE · MAIN &amp; SIDE QUESTS · COACH'S READ"
          meaning="The Engine is weekly load vs. the athlete's own 8-week rhythm band — a band to stay inside, not a score to maximize. Quest and Coach's Read share its right rail on Home, same as here: quiet progress bars, then the coach's signed interpretation of the day."
          interaction={<>Move across the Engine's 6-week trend for per-week load values. Quest and Coach's Read have no tap targets in this release — Quest logging and the coach thread live on their own pages.</>}
          asides={[{
            label: "BELOW 720PX — HOME LAYS THIS OUT DIFFERENTLY",
            content: <>Home swaps this rail for a compact Quest bar paired with Calories, and drops Coach's Read entirely (the thread continues in Coach Chat). Shown full-size here for reference at every width.</>,
          }]}
        >
          <div className="wi-hero-row">
            <EngineCard engine={GALLERY_ENGINE} />
            <aside aria-label="Quest and coach summary" className="wg-rail">
              <QuestCard quest={GALLERY_QUEST} />
              <CoachReadCard read={GALLERY_COACH_READ} />
            </aside>
          </div>
        </GallerySection>

        <GallerySection
          id="commitments"
          index="02"
          title="SPORT COMMITMENTS"
          meaning="One cube per promise. The alarm tint floods when a floor is missed — disappointment in the coach's voice, not the app's."
          interaction={<>Tap the badminton record line to toggle ALL ⇄ RANKED — the only tap target on Home in this release. The calisthenics cube below is showing its alarm state: floor missed, "The bar is cold."</>}
        >
          <section aria-label="Weekly sport commitments" className="wi-commitment-grid">
            {GALLERY_COMMITMENTS.map((item) => (
              <SportCommitmentCard item={item} key={item.id} />
            ))}
          </section>
        </GallerySection>

        <GallerySection
          id="plan"
          index="04 · 07"
          title="WEEKLY PLAN · MONTHLY CALORIES"
          meaning="The Weekly Plan is the coach's draft week, dashed because nothing here has been earned yet — projected load is its consequence. Calories is a pace, not a quota: the black tick is where the month is, the terracotta fill is where the athlete is."
          interaction={<>Drag a sport chip onto another day — empty days accept, occupied days swap, and the projection recomputes live and turns terracotta if it leaves the band. Arrow keys + Space/Enter work too. On Calories, hover the pace bar for the on-pace math.</>}
          asides={[{
            label: "iOS ONLY — NOT ON THIS PAGE",
            content: <>Weekly Plan: long-press-drag instead of mouse drag. A haptic tick on drop is proposed, not built.</>,
          }]}
        >
          <div className="wi-split-row">
            <WeeklyPlanCard plan={GALLERY_PLAN} />
            <CaloriesCard calories={GALLERY_CALORIES} />
          </div>
        </GallerySection>

        <GallerySection
          id="sessions"
          index="05 · 11"
          title="RECENT SESSIONS · BUILD PHASE"
          meaning="Recent Sessions is the ledger — rows are receipts, not feed items. Build Phase shows where the athlete is in the block and what lands if the plan holds; every missed bar day slides the dates right."
          interaction={<>Hover a Build Phase milestone row for its projection math (assumptions + last test). Recent Sessions is static on web in this release — no tap target.</>}
          asides={[{
            label: "iOS ONLY — NOT ON THIS PAGE",
            content: <>Recent Sessions: swipe a row left → Edit only (72px, amber). Deletion is intentionally absent from Home; it lives in session detail.</>,
          }]}
        >
          <div className="wi-split-row">
            <RecentSessionsCard sessions={GALLERY_SESSIONS} />
            <BuildPhaseCard phase={GALLERY_PHASE} />
          </div>
        </GallerySection>

        <GallerySection
          id="heatmap"
          index="06 · 09"
          title="TRAINING ACTIVITY · VO2 MAX"
          meaning="Training Activity makes consistency visible — sport-colored days, not intensity gradients, because showing up is the metric. VO2 Max is the long game: proof the boring easy volume works."
          interaction={<>Click the ‹ › arrows to page the heatmap's four-month window back through the block. Move across the VO2 trend for per-month values. The second VO2 card shows the empty state a widget collapses to with no Apple Health import — never a placeholder number.</>}
          asides={[{
            label: "BELOW 720PX — HIDDEN ON HOME",
            content: <>Both cards are desktop-only on Home (dropped below 720px, same breakpoint as the sport analytics nav) — this section will disappear at phone widths here too. Widen the window to see it.</>,
          }]}
        >
          <div className="wi-split-row wi-evidence-row">
            <TrainingActivityCard activity={GALLERY_TRAINING_ACTIVITY} />
            <Vo2Card vo2={GALLERY_VO2} />
          </div>
          <div className="wi-split-row" style={{ marginTop: 24 }}>
            <div />
            <Vo2Card vo2={GALLERY_VO2_EMPTY} />
          </div>
        </GallerySection>
      </div>
    </div>
  );
}
