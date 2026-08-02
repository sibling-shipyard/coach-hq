import { useState } from "react";
import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import { AuthPageHeader } from "@/components/login/AuthPageHeader";

/**
 * Shown when list-my-repos.ts (see AuthContext.tsx) resolves 2+ owned coach-phelps repos for
 * this account - installs are single-repo by design going forward, so this only comes up for
 * accounts installed before that convention. Picking a repo persists it to the session cookie
 * server-side (list-my-repos.ts's ?select= branch), then a full reload picks it up via
 * AuthContext's normal /api/auth/me path.
 */
export default function RepoPicker({ candidates }: { candidates: string[] }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(repo: string) {
    setPending(repo);
    setError(null);
    try {
      const res = await fetch(`/api/auth/list-my-repos?select=${encodeURIComponent(repo)}`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't select that repo - try again.");
        setPending(null);
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Couldn't select that repo - try again.");
      setPending(null);
    }
  }

  return (
    <div className="wi-shell">
      <AuthPageHeader action={{ label: "Cancel", href: "/welcome" }} />
      <div className="auth-card-shell">
        <div className="auth-card">
          <span className="auth-card__eyebrow">Sign-in</span>
          <h1 className="auth-card__heading">Which repo is this?</h1>
          <p className="auth-card__body">
            Your GitHub account has more than one coach-phelps repo. Pick the one you want to log
            into.
          </p>
          {error && <p className="auth-card__body">{error}</p>}
          <div className="auth-card__buttons">
            {candidates.map((repo) => (
              <button
                key={repo}
                type="button"
                className="auth-card__button auth-card__button--primary"
                disabled={pending !== null}
                onClick={() => handleSelect(repo)}
              >
                {pending === repo ? "Selecting…" : repo}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
