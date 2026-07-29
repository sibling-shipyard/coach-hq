import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Dumbbell, Home, LogOut, Menu, MessageSquare } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityGlyph } from "./ActivityGlyph";
import type { SportAnalyticsNavLink } from "./snapshots";

export const DEFAULT_SPORT_ANALYTICS_LINKS: SportAnalyticsNavLink[] = [
  { glyph: "badminton", href: "/analytics/badminton", title: "Badminton analytics" },
  { glyph: "run", href: "/analytics/running", title: "Running analytics" },
  { glyph: "calisthenics", href: "/analytics/calisthenics", title: "Calisthenics analytics" },
];

function AnalyticsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M4 20V13" />
      <path d="M10 20V6" />
      <path d="M16 20V10" />
      <path d="M22 4" />
      <path d="M4 20H20" />
    </svg>
  );
}

function SyncIcon({ healthy }: { healthy: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={healthy ? "is-healthy" : "is-warning"}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M20 5v5h-5" />
      <path d="M4 19v-5h5" />
      <path d="M19.6 10A8 8 0 0 0 6.4 6.6L4 9" />
      <path d="M4.4 14a8 8 0 0 0 13.2 3.4L20 15" />
    </svg>
  );
}

function HeaderNavMenu({
  homeHref,
  workoutsHref,
  sportAnalyticsLinks,
  analyticsHref,
  coachChatHref,
  currentRoute,
  showAccountActions,
  login,
  syncHealthy,
  syncLabel,
}: {
  homeHref: string;
  workoutsHref: string;
  sportAnalyticsLinks: SportAnalyticsNavLink[];
  analyticsHref: string;
  coachChatHref: string;
  currentRoute?: string;
  showAccountActions: boolean;
  login?: string;
  syncHealthy: boolean;
  syncLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const menuHasActive = currentRoute
    ? [
        ...sportAnalyticsLinks.map((link) => link.href),
        analyticsHref,
      ].includes(currentRoute)
    : false;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function closeMenu() {
    setOpen(false);
  }

  return (
    <div className="wi-instrument-header__menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More navigation"
        className={`wi-instrument-header__menu-btn ${menuHasActive ? "is-active" : ""}`.trim()}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Menu aria-hidden="true" size={20} strokeWidth={1.8} />
      </button>
      {open ? (
        <div className="wi-instrument-header__menu-panel" role="menu">
          <Link
            className={`wi-mobile-only ${currentRoute === homeHref ? "is-active" : ""}`.trim()}
            href={homeHref}
            onClick={closeMenu}
            role="menuitem"
          >
            <Home aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>Home</span>
          </Link>
          <Link
            className={`wi-mobile-only ${currentRoute === workoutsHref ? "is-active" : ""}`.trim()}
            href={workoutsHref}
            onClick={closeMenu}
            role="menuitem"
          >
            <Dumbbell aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>Workouts</span>
          </Link>
          <Link
            className={`wi-mobile-only ${currentRoute === coachChatHref ? "is-active" : ""}`.trim()}
            href={coachChatHref}
            onClick={closeMenu}
            role="menuitem"
          >
            <MessageSquare aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>Coach Chat</span>
          </Link>
          <div aria-hidden="true" className="wi-instrument-header__menu-divider wi-mobile-only" />
          {sportAnalyticsLinks.map((link) => (
            <Link
              key={link.href}
              className={currentRoute === link.href ? "is-active" : undefined}
              href={link.href}
              onClick={closeMenu}
              role="menuitem"
            >
              <ActivityGlyph kind={link.glyph} size={18} />
              <span>{link.title}</span>
            </Link>
          ))}
          <Link
            className={currentRoute === analyticsHref ? "is-active" : undefined}
            href={analyticsHref}
            onClick={closeMenu}
            role="menuitem"
          >
            <AnalyticsIcon size={18} />
            <span>Monthly analytics</span>
          </Link>
          <div aria-hidden="true" className="wi-instrument-header__menu-divider" />
          <div aria-label={`Synced · ${syncLabel}`} className="wi-instrument-header__menu-sync" role="status">
            <SyncIcon healthy={syncHealthy} />
            <span>Synced · {syncLabel}</span>
          </div>
          {showAccountActions ? (
            <>
              <div aria-hidden="true" className="wi-instrument-header__menu-divider" />
              <a href="/api/auth/logout" onClick={closeMenu} role="menuitem">
                <LogOut aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>Sign out{login ? ` (${login})` : ""}</span>
              </a>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function InstrumentHeader({
  phaseLabel,
  mobilePhaseLabel,
  syncLabel,
  syncHealthy,
  homeHref = "/",
  sportAnalyticsLinks = DEFAULT_SPORT_ANALYTICS_LINKS,
  analyticsHref = "/analytics/monthly",
  workoutsHref = "/workouts",
  coachChatHref = "/coach-chat",
  currentRoute,
}: {
  phaseLabel: string;
  mobilePhaseLabel?: string;
  syncLabel: string;
  syncHealthy: boolean;
  homeHref?: string;
  sportAnalyticsLinks?: SportAnalyticsNavLink[];
  analyticsHref?: string;
  workoutsHref?: string;
  coachChatHref?: string;
  currentRoute?: string;
}) {
  const auth = useAuth();
  const showAccountActions = auth.status === "authenticated";

  return (
    <header className="wi-instrument-header">
      <Link className="wi-instrument-header__brand" href={homeHref}>
        <span className="wi-desktop-only">COACH PHELPS · HQ</span>
        <span className="wi-mobile-only">HQ</span>
      </Link>
      <span className="wi-instrument-header__phase">
        <span className="wi-desktop-only">{phaseLabel}</span>
        <span className="wi-mobile-only">{mobilePhaseLabel ?? phaseLabel}</span>
      </span>
      <div className="wi-instrument-header__actions">
        <nav className="wi-instrument-header__nav" aria-label="Primary navigation">
          <Link
            aria-current={currentRoute === homeHref ? "page" : undefined}
            className={currentRoute === homeHref ? "is-active" : undefined}
            href={homeHref}
            title="Home"
          >
            <Home aria-hidden="true" size={20} strokeWidth={1.8} />
            <span className="sr-only">Home</span>
          </Link>
          <Link
            aria-current={currentRoute === workoutsHref ? "page" : undefined}
            className={currentRoute === workoutsHref ? "is-active" : undefined}
            href={workoutsHref}
            title="Workouts"
          >
            <Dumbbell aria-hidden="true" size={20} strokeWidth={1.8} />
            <span className="sr-only">Workouts</span>
          </Link>
          <Link
            aria-current={currentRoute === coachChatHref ? "page" : undefined}
            className={currentRoute === coachChatHref ? "is-active" : undefined}
            href={coachChatHref}
            title="Coach Chat"
          >
            <MessageSquare aria-hidden="true" size={20} strokeWidth={1.8} />
            <span className="sr-only">Coach Chat</span>
          </Link>
        </nav>
        <HeaderNavMenu
          analyticsHref={analyticsHref}
          coachChatHref={coachChatHref}
          currentRoute={currentRoute}
          homeHref={homeHref}
          login={auth.login}
          showAccountActions={showAccountActions}
          sportAnalyticsLinks={sportAnalyticsLinks}
          syncHealthy={syncHealthy}
          syncLabel={syncLabel}
          workoutsHref={workoutsHref}
        />
      </div>
    </header>
  );
}
