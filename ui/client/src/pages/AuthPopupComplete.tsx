import { useEffect } from "react";

/**
 * Landed on only inside the popup window GitHubAuthButton opens (never in a normal tab) -
 * callback.ts redirects here instead of "/" whenever the OAuth round trip started in popup
 * mode. Posts the outcome back to window.opener and closes itself; the opener's
 * lib/authPopup.ts is what's actually listening. No design needed - this is on screen for a
 * single frame at most.
 */
export default function AuthPopupComplete() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = {
      type: "coach-auth-complete" as const,
      ok: params.get("ok") === "1",
      login: params.get("login") ?? undefined,
      error: params.get("error") ?? undefined,
    };

    if (window.opener) {
      window.opener.postMessage(result, window.location.origin);
      window.close();
    } else {
      // No opener - popup blockers/some in-app browsers can strip window.opener even though
      // window.open() itself succeeded. lib/authPopup.ts's popup.closed poll below still
      // resolves once this tab is closed manually, so redirect somewhere useful instead of
      // leaving a dead end.
      window.location.href = result.ok ? "/" : `/?auth_error=${encodeURIComponent(result.error ?? "unknown")}`;
    }
  }, []);

  return null;
}
