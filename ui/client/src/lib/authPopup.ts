/**
 * Opens GitHub sign-in (or the App-install step) in a popup window instead of navigating the
 * whole tab away and back - the web equivalent of iOS's in-app WKWebView sheet
 * (GitHubAuthManager.swift/WebAuthPresenter.swift). The popup closes itself via
 * pages/AuthPopupComplete.tsx posting a message back to window.opener; this just waits for that
 * message (or for the popup to close without one, which means the athlete cancelled).
 */
export interface AuthPopupResult {
  ok: boolean;
  login?: string;
  error?: string;
}

export function openAuthPopup(url: string): Promise<AuthPopupResult> {
  return new Promise((resolve) => {
    // window.open() already preserves window.opener by default for a same-origin target - no
    // window-feature string toggles that (there's no real "noopener=no"), so none is passed.
    const popup = window.open(url, "coach-auth", "width=520,height=680");
    if (!popup) {
      resolve({ ok: false, error: "popup_blocked" });
      return;
    }

    let settled = false;
    let pollClosed: number;

    function finish(result: AuthPopupResult) {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearInterval(pollClosed);
      resolve(result);
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as Partial<AuthPopupResult> & { type?: string };
      if (!data || data.type !== "coach-auth-complete") return;
      finish({
        ok: !!data.ok,
        login: data.login,
        error: data.error,
      });
    }

    window.addEventListener("message", onMessage);
    // GitHub's own pages (repo-create, App install picker) are cross-origin, so we can't read
    // popup.location - closing without ever posting a message is the only signal available for
    // "the athlete closed the window instead of finishing" on those steps.
    pollClosed = window.setInterval(() => {
      if (popup.closed) finish({ ok: false, error: "popup_closed" });
    }, 500);
  });
}
