import { useCallback, useEffect, useRef, useState } from "react";
import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import { AuthPageHeader } from "@/components/login/AuthPageHeader";
import { GitHubAuthButton } from "@/components/login/GitHubAuthButton";

// Landed here from callback.ts's not_installed redirect. These two GitHub-native steps can't
// be automated away: GitHub App tokens can't create personal repos via API (confirmed live -
// 404/403 on /repos/{template}/generate and /user/repos), so the repo has to exist before
// GitHub's install picker has anything to show.
//
// Both steps open in a popup (window.open) instead of navigating the tab away, mirroring
// SetupView.swift's in-app WKWebView sheet:
// - Step 1 (repo create) is GitHub's own page - no postMessage possible, so completion is
//   detected by polling check-repo-exists.ts while the popup is open and on window focus-return.
// - Step 2 (install) is our own callback.ts round trip - GitHubAuthButton's popup+postMessage
//   flow gives a deterministic "done" signal, no polling needed.
export default function Setup() {
  const params = new URLSearchParams(window.location.search);
  const login = params.get("login") ?? "";

  const [repoExists, setRepoExists] = useState(false);
  const [checking, setChecking] = useState(false);
  const repoPopupRef = useRef<Window | null>(null);

  const generateUrl = new URL("https://github.com/new");
  generateUrl.searchParams.set("template_owner", "sibling-shipyard");
  generateUrl.searchParams.set("template_name", "coach-skeleton");
  if (login) generateUrl.searchParams.set("owner", login);
  if (login) generateUrl.searchParams.set("name", `coach-${login}`);
  generateUrl.searchParams.set("visibility", "private");

  const checkRepoExists = useCallback(async () => {
    if (!login || repoExists) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/auth/check-repo-exists?login=${encodeURIComponent(login)}`);
      if (res.ok) {
        const data = (await res.json()) as { exists?: boolean };
        if (data.exists) setRepoExists(true);
      }
      // A 401 here means the short-lived setup cookie expired - the manual "I've done this"
      // fallback below still lets the athlete continue to step 2 without a second sign-in.
    } catch {
      // Transient network blip - the interval/focus-return triggers below will just retry.
    } finally {
      setChecking(false);
    }
  }, [login, repoExists]);

  // Poll while the repo-create popup is open, and once more when the athlete tabs back to this
  // window (covers the common case: they finish on GitHub, close the tab themselves, and
  // refocus here before the interval below would have caught it).
  useEffect(() => {
    if (repoExists) return;
    function onVisibilityChange() {
      if (document.visibilityState === "visible") void checkRepoExists();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [checkRepoExists, repoExists]);

  useEffect(() => {
    if (repoExists) return;
    const interval = window.setInterval(() => {
      if (repoPopupRef.current && !repoPopupRef.current.closed) void checkRepoExists();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [checkRepoExists, repoExists]);

  function openRepoCreatePopup() {
    repoPopupRef.current = window.open(generateUrl.toString(), "coach-repo-create", "width=760,height=800");
  }

  return (
    <div className="wi-shell">
      <AuthPageHeader action={{ label: "Cancel", href: "/welcome" }} />
      <div className="auth-card-shell">
        <div className="auth-card">
          <span className="auth-card__eyebrow">
            Setting up your coach - Step {repoExists ? "2" : "1"} of 2
          </span>
          <h1 className="auth-card__heading">Two quick steps on GitHub</h1>
          <p className="auth-card__body">
            You&apos;re signed in{login ? ` as ${login}` : ""}. Coach Phelps stores everything in
            your own private GitHub repo, so there are two things GitHub needs you to confirm
            directly - after that, you&apos;re done.
          </p>

          <div className="auth-card__buttons">
            <button
              type="button"
              onClick={openRepoCreatePopup}
              disabled={repoExists}
              className="auth-card__button auth-card__button--primary"
            >
              {repoExists ? "1. Repo created ✓" : "1. Create your repo on GitHub ↗"}
            </button>

            {!repoExists && (
              <button type="button" onClick={() => void checkRepoExists()} className="auth-card__button" disabled={checking}>
                {checking ? "Checking…" : "I've done this - continue"}
              </button>
            )}

            <GitHubAuthButton
              href="/api/auth/install-redirect"
              disabled={!repoExists}
              className="auth-card__button auth-card__button--primary"
              onNeedsSetup={() => {
                // install-redirect's own round trip can't land back in "needs_setup" - the
                // repo already exists by this point - but keep the same contract as every
                // other GitHubAuthButton call site rather than assuming it can't happen.
                window.location.href = `/setup?login=${encodeURIComponent(login)}`;
              }}
            >
              2. Authorize Coach Phelps on that repo →
            </GitHubAuthButton>
          </div>

          <p className="auth-card__body">
            Step 1 opens GitHub in a window, pre-filled - just click their green &quot;Create
            repository&quot; button. This page notices automatically once it's done. Step 2 then
            gives Coach Phelps access to that one repo only.
          </p>
        </div>
      </div>
    </div>
  );
}
