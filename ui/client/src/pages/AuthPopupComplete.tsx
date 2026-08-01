import { useEffect } from "react";
import { AUTH_POPUP_CHANNEL } from "@/lib/authPopup";

/**
 * Landed on only inside the popup window GitHubAuthButton opens (never in a normal tab) -
 * callback.ts redirects here instead of "/" whenever the OAuth round trip started in popup
 * mode. Posts the outcome over a BroadcastChannel and closes itself; the opener's
 * lib/authPopup.ts is what's actually listening. No design needed - this is on screen for a
 * single frame at most.
 *
 * Not window.opener/postMessage: GitHub's OAuth pages send Cross-Origin-Opener-Policy:
 * same-origin, which permanently severs window.opener once this popup has navigated through
 * github.com mid-flow - window.opener is reliably null by the time this page loads. Always
 * closing unconditionally still works: the "opened via window.open()" closable flag a browser
 * tracks is independent of window.opener/COOP. See lib/authPopup.ts for the full explanation.
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

    const channel = new BroadcastChannel(AUTH_POPUP_CHANNEL);
    channel.postMessage(result);
    channel.close();
    window.close();
  }, []);

  return null;
}
