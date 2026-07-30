import type { ReactNode } from "react";
import { openAuthPopup } from "@/lib/authPopup";

interface GitHubAuthButtonProps {
  /** Defaults to the plain sign-in endpoint; pass install-redirect's URL for the setup step. */
  href?: string;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
  onNeedsSetup?: (login: string) => void;
  onSuccess?: () => void;
}

/**
 * Same class names the old `<a href>` used - class-only CSS selectors in login.css already
 * support a <button>, so swapping the element doesn't need any style changes. Behavior: opens
 * the GitHub flow in a popup (see lib/authPopup.ts); falls back to a full-page redirect if the
 * popup is blocked, so there's always a way to sign in.
 */
export function GitHubAuthButton({
  href = "/api/auth/start",
  className,
  disabled,
  children,
  onNeedsSetup,
  onSuccess,
}: GitHubAuthButtonProps) {
  async function handleClick() {
    const popupUrl = href.includes("?") ? `${href}&popup=1` : `${href}?popup=1`;
    const result = await openAuthPopup(popupUrl);

    if (result.error === "popup_blocked") {
      window.location.href = href;
      return;
    }
    if (result.error === "popup_closed") {
      return; // athlete cancelled - stay put, no error needed
    }
    if (result.needsSetup) {
      const login = result.login ?? "";
      if (onNeedsSetup) onNeedsSetup(login);
      else window.location.href = `/setup?login=${encodeURIComponent(login)}`;
      return;
    }
    if (result.ok) {
      if (onSuccess) onSuccess();
      else window.location.href = "/";
      return;
    }
    window.location.href = `/?auth_error=${encodeURIComponent(result.error ?? "unknown")}`;
  }

  return (
    <button type="button" onClick={handleClick} className={className} disabled={disabled}>
      {children}
    </button>
  );
}
