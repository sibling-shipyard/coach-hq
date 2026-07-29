import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import { AuthPageHeader } from "@/components/login/AuthPageHeader";

// Landed here from callback.ts's not_installed redirect. These two GitHub-native steps can't
// be automated away: GitHub App tokens can't create personal repos via API (confirmed live -
// 404/403 on /repos/{template}/generate and /user/repos), so the repo has to exist before
// GitHub's install picker has anything to show.
export default function Setup() {
  const params = new URLSearchParams(window.location.search);
  const login = params.get("login") ?? "";

  const generateUrl = new URL("https://github.com/new");
  generateUrl.searchParams.set("template_owner", "sibling-shipyard");
  generateUrl.searchParams.set("template_name", "coach-skeleton");
  if (login) generateUrl.searchParams.set("owner", login);
  if (login) generateUrl.searchParams.set("name", `coach-${login}`);
  generateUrl.searchParams.set("visibility", "private");

  return (
    <div className="wi-shell">
      <AuthPageHeader action={{ label: "Cancel", href: "/welcome" }} />
      <div className="auth-card-shell">
        <div className="auth-card">
          <span className="auth-card__eyebrow">Setting up your coach</span>
          <h1 className="auth-card__heading">Two quick steps on GitHub</h1>
          <p className="auth-card__body">
            You&apos;re signed in{login ? ` as ${login}` : ""}. Coach Phelps stores everything in
            your own private GitHub repo, so there are two things GitHub needs you to confirm
            directly - after that, you&apos;re done.
          </p>

          <div className="auth-card__buttons">
            <a
              href={generateUrl.toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="auth-card__button auth-card__button--primary"
            >
              1. Create your repo on GitHub ↗
            </a>
            <a href="/api/auth/install-redirect" className="auth-card__button">
              2. Continue to install (after step 1) →
            </a>
          </div>

          <p className="auth-card__body">
            Step 1 opens GitHub in a new tab, pre-filled - just click their green &quot;Create
            repository&quot; button. Once that&apos;s done, come back here and click step 2, which
            gives Coach Phelps access to that one repo only. If you click step 2 first, GitHub
            just won&apos;t have your repo to pick yet - go back and finish step 1, then try
            again.
          </p>
        </div>
      </div>
    </div>
  );
}
