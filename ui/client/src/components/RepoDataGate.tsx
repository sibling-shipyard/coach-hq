import type { ReactNode } from "react";
import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import { AuthPageHeader } from "@/components/login/AuthPageHeader";

interface Props {
  loading: boolean;
  error: string | null;
  schemaUnsupported: boolean;
  notOnboarded?: boolean;
  // True on repo-file.ts's 401 - GitHub access was revoked/expired mid-session, not a generic
  // fetch failure. Optional: only Home.tsx passes this today, other useRepoData() consumers
  // fall back to the generic error state below until they're migrated too.
  accessRevoked?: boolean;
  children: ReactNode;
}

const RECOVERY_ACTIONS = (
  <div className="auth-card__buttons">
    <a href="/?switch_repo=1" className="auth-card__button auth-card__button--primary">
      Switch repo
    </a>
    <a href="/api/auth/logout" className="auth-card__button">
      Sign out
    </a>
  </div>
);

/** Loading/error/schema-mismatch/not-onboarded states shared by every page reading useRepoData(). */
export function RepoDataGate({ loading, error, schemaUnsupported, notOnboarded, accessRevoked, children }: Props) {
  if (loading) {
    return (
      <div className="wi-shell">
        <AuthPageHeader />
        <div className="auth-card-shell">
          <p className="auth-card__eyebrow">Loading your data…</p>
        </div>
      </div>
    );
  }

  // challenge_v2 is null until Coach's first session ever runs and writes to it - a
  // freshly-provisioned repo (see ui/api/auth/callback.ts + pages/Setup.tsx) genuinely has
  // no coaching data yet, so there's nothing real to render on the dashboard. Distinct from
  // `error`: this isn't a failure, it's the expected state for day zero. Still offers a way
  // out (switch/sign out) in case the athlete actually meant to land on a different repo.
  if (notOnboarded) {
    return (
      <div className="wi-shell">
        <AuthPageHeader action={{ label: "Sign out", href: "/api/auth/logout" }} />
        <div className="auth-card-shell">
          <div className="auth-card">
            <h2 className="auth-card__heading">Your coach hasn't started yet</h2>
            <p className="auth-card__body">
              Your repo is set up, but Coach Phelps hasn't run a first session with you. Open
              this repo with Claude Code and start a session to get going - the dashboard fills
              in once that's happened.
            </p>
            {RECOVERY_ACTIONS}
          </div>
        </div>
      </div>
    );
  }

  if (schemaUnsupported) {
    return (
      <div className="wi-shell">
        <AuthPageHeader action={{ label: "Sign out", href: "/api/auth/logout" }} />
        <div className="auth-card-shell">
          <div className="auth-card">
            <h2 className="auth-card__heading">Repo needs updating</h2>
            <p className="auth-card__body">
              Your repo's data format is newer than what this dashboard supports. Pull the
              latest template changes and sync again.
            </p>
            {RECOVERY_ACTIONS}
          </div>
        </div>
      </div>
    );
  }

  if (error && accessRevoked) {
    return (
      <div className="wi-shell">
        <AuthPageHeader action={{ label: "Sign out", href: "/api/auth/logout" }} />
        <div className="auth-card-shell">
          <div className="auth-card">
            <h2 className="auth-card__heading">Your GitHub access expired</h2>
            <p className="auth-card__body">
              Your session is still active, but GitHub access was revoked or expired - this
              happens if you uninstalled the App or removed its access on GitHub's side. Sign
              in again to reconnect.
            </p>
            <div className="auth-card__buttons">
              <a href="/api/auth/start" className="auth-card__button auth-card__button--primary">
                Sign in again
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wi-shell">
        <AuthPageHeader action={{ label: "Sign out", href: "/api/auth/logout" }} />
        <div className="auth-card-shell">
          <div className="auth-card">
            <h2 className="auth-card__heading">Couldn't load your data</h2>
            <p className="auth-card__body auth-card__body--error">{error}</p>
            <p className="auth-card__body">
              This can happen if your repo was renamed, deleted, or hasn't finished setting up
              yet.
            </p>
            {RECOVERY_ACTIONS}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
