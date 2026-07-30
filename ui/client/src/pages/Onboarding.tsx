import { useEffect, useState } from "react";
import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import { AuthPageHeader } from "@/components/login/AuthPageHeader";
import { GitHubAuthButton } from "@/components/login/GitHubAuthButton";

interface RepoResult {
  candidates?: string[];
  repo_full_name?: string;
  reason?: "no_owned_repos" | "no_marker_match";
  error?: string;
}

const EMPTY_STATE_COPY: Record<string, { heading: string; body: string }> = {
  no_owned_repos: {
    heading: "No repo granted yet",
    body: "You haven't granted Coach Phelps access to any of your own repos. Sign up again and pick one during install.",
  },
  no_marker_match: {
    heading: "Not set up yet",
    body: "None of the repos you granted access to have propagated/SOUL.md and user_data/ledger/challenge_v2.json. Finish setting one up, then sign in again.",
  },
};

export default function Onboarding() {
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [login, setLogin] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setLogin(data?.login ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/auth/list-my-repos")
      .then(async (res) => {
        const data: RepoResult = await res.json();
        if (data.repo_full_name) {
          window.location.href = "/";
          return;
        }
        if (data.candidates) {
          setCandidates(data.candidates);
          setReason(data.reason ?? null);
        } else if (data.error) {
          setError(data.error);
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to look up your repos.");
        setLoading(false);
      });
  }, []);

  async function selectRepo(fullName: string) {
    setSelecting(true);
    const res = await fetch(`/api/auth/list-my-repos?select=${encodeURIComponent(fullName)}`);
    if (res.ok) {
      window.location.href = "/";
    } else {
      setError("Couldn't select that repo - try again.");
      setSelecting(false);
    }
  }

  const emptyCopy = reason ? EMPTY_STATE_COPY[reason] : null;

  return (
    <div className="wi-shell">
      <AuthPageHeader action={{ label: "Sign out", href: "/api/auth/logout" }} />
      <div className="auth-card-shell">
        <div className="auth-card">
          {loading && <p className="auth-card__eyebrow">Looking for your coach repo…</p>}

          {!loading && error && <p className="auth-card__body auth-card__body--error">{error}</p>}

          {!loading && !error && candidates.length === 0 && (
            <>
              <h2 className="auth-card__heading">{emptyCopy?.heading ?? "No repo found"}</h2>
              <p className="auth-card__body">
                {emptyCopy?.body ??
                  "None of the repos you granted access to have propagated/SOUL.md and user_data/ledger/challenge_v2.json."}
              </p>
              <div className="auth-card__buttons">
                {login ? (
                  <a href={`/setup?login=${encodeURIComponent(login)}`} className="auth-card__button auth-card__button--primary">
                    Try setup again
                  </a>
                ) : (
                  <GitHubAuthButton className="auth-card__button auth-card__button--primary">
                    Try setup again
                  </GitHubAuthButton>
                )}
                <a href="/api/auth/logout" className="auth-card__button">
                  Sign out
                </a>
              </div>
            </>
          )}

          {!loading && !error && candidates.length > 0 && (
            <>
              <h2 className="auth-card__heading">Which repo is yours?</h2>
              <div className="auth-card__buttons">
                {candidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={selecting}
                    onClick={() => selectRepo(c)}
                    className="auth-card__button auth-card__button--repo"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
