import type { ReactNode } from "react";
import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";

interface Props {
  loading: boolean;
  error: string | null;
  schemaUnsupported: boolean;
  notOnboarded?: boolean;
  children: ReactNode;
}

/** Loading/error/schema-mismatch/not-onboarded states shared by every page reading useRepoData(). */
export function RepoDataGate({ loading, error, schemaUnsupported, notOnboarded, children }: Props) {
  if (loading) {
    return (
      <div className="wi-shell">
        <div className="auth-card-shell">
          <p className="auth-card__eyebrow">Loading your data…</p>
        </div>
      </div>
    );
  }

  // challenge_v2 is null until Coach's first session ever runs and writes to it - a
  // freshly-provisioned repo (see ui/api/auth/callback.ts + pages/Setup.tsx) genuinely has
  // no coaching data yet, so there's nothing real to render on the dashboard. Distinct from
  // `error`: this isn't a failure, it's the expected state for day zero.
  if (notOnboarded) {
    return (
      <div className="wi-shell">
        <div className="auth-card-shell">
          <div className="auth-card">
            <h2 className="auth-card__heading">Your coach hasn't started yet</h2>
            <p className="auth-card__body">
              Your repo is set up, but Coach Phelps hasn't run a first session with you. Open
              this repo with Claude Code and start a session to get going - the dashboard fills
              in once that's happened.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (schemaUnsupported) {
    return (
      <div className="wi-shell">
        <div className="auth-card-shell">
          <div className="auth-card">
            <h2 className="auth-card__heading">Repo needs updating</h2>
            <p className="auth-card__body">
              Your repo's data format is newer than what this dashboard supports. Pull the
              latest template changes and sync again.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wi-shell">
        <div className="auth-card-shell">
          <div className="auth-card">
            <h2 className="auth-card__heading">Couldn't load your data</h2>
            <p className="auth-card__body auth-card__body--error">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
