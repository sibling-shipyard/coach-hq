import "@/components/home-warm/warm-instrument.css";
import "@/components/login/login.css";
import { AuthPageHeader } from "@/components/login/AuthPageHeader";

// not_installed used to live here but callback.ts now routes that case straight into
// pages/Setup.tsx's wizard instead of a dead-end error page - see ui/api/auth/callback.ts.
const MESSAGES: Record<string, { heading: string; body: string; cta: string; href: string }> = {
  lookup_failed: {
    heading: "Something went wrong",
    body: "Couldn't check your GitHub installation just now - this is usually a transient GitHub API hiccup. Try again.",
    cta: "Try logging in again",
    href: "/api/auth/start",
  },
  state_mismatch: {
    heading: "Sign-in expired",
    body: "That sign-in link looks stale or was tampered with. Try again.",
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
            <a href={msg.href} className="auth-card__button auth-card__button--primary">
              {msg.cta}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
