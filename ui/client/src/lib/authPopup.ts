/**
 * Opens GitHub sign-in (or the App-install step) in a popup window instead of navigating the
 * whole tab away and back - the web equivalent of iOS's in-app WKWebView sheet
 * (GitHubAuthManager.swift/WebAuthPresenter.swift). The popup closes itself via
 * pages/AuthPopupComplete.tsx posting to a BroadcastChannel; this just waits for that message
 * (or for the popup to close without one, which means the athlete cancelled).
 *
 * Not window.opener/postMessage: GitHub sends Cross-Origin-Opener-Policy: same-origin on its
 * OAuth pages, which permanently severs window.opener once the popup navigates through
 * github.com - even after it navigates back to our own origin for the callback. BroadcastChannel
 * is origin-scoped, not reference-scoped, so it's unaffected. Same fix other COOP-broken popup
 * OAuth flows converged on, e.g. https://github.com/osmlab/osm-auth/pull/138.
 */
export interface AuthPopupResult {
  ok: boolean;
  login?: string;
  error?: string;
}

export const AUTH_POPUP_CHANNEL = "coach-auth-popup";

export function openAuthPopup(url: string): Promise<AuthPopupResult> {
  return new Promise((resolve) => {
    const popup = window.open(url, "coach-auth", "width=520,height=680");
    if (!popup) {
      resolve({ ok: false, error: "popup_blocked" });
      return;
    }

    let settled = false;
    let pollClosed: number;
    const channel = new BroadcastChannel(AUTH_POPUP_CHANNEL);

    function finish(result: AuthPopupResult) {
      if (settled) return;
      settled = true;
      channel.close();
      window.clearInterval(pollClosed);
      resolve(result);
    }

    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as Partial<AuthPopupResult> & { type?: string };
      if (!data || data.type !== "coach-auth-complete") return;
      finish({
        ok: !!data.ok,
        login: data.login,
        error: data.error,
      });
    };

    // GitHub's own pages (repo-create, App install picker) are cross-origin, so we can't read
    // popup.location - closing without ever posting a message is the only signal available for
    // "the athlete closed the window instead of finishing" on those steps.
    pollClosed = window.setInterval(() => {
      if (popup.closed) finish({ ok: false, error: "popup_closed" });
    }, 500);
  });
}
