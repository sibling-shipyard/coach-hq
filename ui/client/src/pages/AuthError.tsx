import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import { AuthPageHeader } from "@/components/login/AuthPageHeader";
import { GitHubAuthButton } from "@/components/login/GitHubAuthButton";

interface AuthErrorMessage {
  heading: string;
  body: string;
  cta: string;
  href: string;
  /** Plain navigation link instead of GitHubAuthButton's OAuth-popup trigger. */
  isLink?: boolean;
}

const MESSAGES: Record<string, AuthErrorMessage> = {
  // First-time setup (repo creation + first session) moved to iOS only - see issue #164.
  // TODO(#164): fill in the real App Store name/link once the app has a name and the
  // developer license comes through.
  needs_ios_setup: {
    heading: "Set up on iOS first",
    body: "Coach Phelps setup - creating your repo and running your first session - now happens in the iOS app. Download it from the App Store (link coming soon), finish setup there, then come back here to log in.",
    cta: "Back to welcome",
    href: "/welcome",
    isLink: true,
  },
  lookup_failed: {
    heading: "Something went wrong",
    body: "Couldn't check your GitHub installation just now - this is usually a transient GitHub API hiccup. Try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  no_owned_repos: {
    heading: "Set up on iOS first",
    body: "Your GitHub App install doesn't include any repo you own yet. Coach Phelps setup happens in the iOS app - finish it there, then come back here to log in.",
    cta: "Back to welcome",
    href: "/welcome",
    isLink: true,
  },
  multiple_repos_granted: {
    heading: "Remove access to the extra repos",
    body: "Your GitHub App install grants access to more than one repo you own, and Coach Phelps only supports one repo per account. Go to GitHub's installation settings, open the Coach Phelps app, and deselect all but one repo, then come back and log in again.",
    cta: "Open GitHub settings",
    href: "https://github.com/settings/installations",
    isLink: true,
  },
  no_marker_match: {
    heading: "Set up on iOS first",
    body: "None of the repos you've granted access to look like a coach-phelps repo yet. Finish setup in the iOS app, then come back here to log in.",
    cta: "Back to welcome",
    href: "/welcome",
    isLink: true,
  },
  state_mismatch: {
    heading: "Sign-in expired",
    body: "That sign-in link looks stale, or you may have had more than one sign-in tab open at once - only the most recent one works. Close any other sign-in tabs and try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  network_error: {
    heading: "Something went wrong",
    body: "Couldn't reach GitHub just now - this is usually a transient network issue. Try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  missing_oauth_session: {
    heading: "Sign-in expired",
    body: "Your sign-in session expired before GitHub redirected back. Try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  corrupt_oauth_session: {
    heading: "Sign-in expired",
    body: "Your sign-in session expired before GitHub redirected back. Try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  missing_params: {
    heading: "Sign-in incomplete",
    body: "GitHub didn't send back what we needed to finish signing you in. Try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  token_exchange_failed: {
    heading: "Something went wrong",
    body: "GitHub rejected the sign-in exchange. Try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  user_fetch_failed: {
    heading: "Something went wrong",
    body: "Couldn't fetch your GitHub profile just now. Try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  config_error: {
    heading: "Site misconfigured",
    body: "The site isn't set up correctly - this isn't something you can fix. Let Skanda or Akash know.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
};

const FALLBACK = MESSAGES.token_exchange_failed;

export default function AuthError({ type }: { type: string }) {
  const msg = MESSAGES[type] ?? FALLBACK;

  return (
    <div className="wi-shell">
      <AuthPageHeader action={{ label: "Cancel", href: "/welcome" }} />
      <div className="auth-card-shell">
        <div className="auth-card">
          <span className="auth-card__eyebrow">Sign-in error</span>
          <h1 className="auth-card__heading">{msg.heading}</h1>
          <p className="auth-card__body">{msg.body}</p>
          <div className="auth-card__buttons">
            {msg.isLink ? (
              <a href={msg.href} className="auth-card__button auth-card__button--primary">
                {msg.cta}
              </a>
            ) : (
              <GitHubAuthButton
                href={msg.href}
                className="auth-card__button auth-card__button--primary"
              >
                {msg.cta}
              </GitHubAuthButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
