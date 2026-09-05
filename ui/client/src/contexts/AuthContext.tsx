/**
 * AuthContext — gates the app on /api/auth/me.
 *
 * "local" status covers plain `npm run dev`/self-hosted single-repo use, where
 * there's no hosted auth layer at all. Keyed off isLocalDevBypass (Vite's import.meta.env.DEV,
 * unless VITE_FORCE_HOSTED_AUTH=true opts into real auth for local testing - see
 * ui/.env.local.example and #61), not response shape - inferring "no /api layer" from a
 * non-JSON or failed response is wrong: a genuine production error would look identical
 * and silently unlock the dashboard instead of showing a gate. Any real
 * fetch/parse failure on the hosted deployment falls back to "unauthenticated"
 * (the login screen), never "local".
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isLocalDevBypass } from "../lib/devMode";
import { captureFetchFailure, setAthleteUser } from "../lib/observability";

export type AuthStatus = "loading" | "local" | "unauthenticated" | "authenticated" | "auth_error";

interface AuthState {
  status: AuthStatus;
  login?: string;
  repoFullName?: string | null;
  /** auth_error only - which AuthError message to show. */
  errorType?: string;
}

const AuthContext = createContext<AuthState>({ status: "loading" });

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(
    isLocalDevBypass ? { status: "local" } : { status: "loading" },
  );

  useEffect(() => {
    if (isLocalDevBypass) return; // no hosted auth layer in local dev - already set above

    let cancelled = false;

    fetch("/api/auth/me")
      .then(async (res) => {
        if (cancelled) return;

        if (!res.ok) {
          // 401 is the answer this endpoint exists to give. Anything else is a fault the athlete
          // cannot tell apart from being signed out: `ensureFreshSession` returns "Site
          // misconfigured" as a 500 *response*, so the API does not capture it either, and a
          // deploy missing GITHUB_APP_CLIENT_ID shows everyone a login screen recorded nowhere.
          if (res.status !== 401) {
            captureFetchFailure("/api/auth/me", { kind: "server", status: res.status });
          }
          setState({ status: "unauthenticated" });
          return;
        }

        const data = await res.json();
        if (data.repo_full_name) {
          setState({
            status: "authenticated",
            login: data.login,
            repoFullName: data.repo_full_name,
          });
          return;
        }

        // Session is valid but no repo resolved yet (list-my-repos is never called by
        // handleCallback itself - see ui/api/auth/[...action].ts's callback web branch) -
        // resolve it now.
        try {
          const reposRes = await fetch("/api/auth/list-my-repos");
          if (cancelled) return;
          const reposData = await reposRes.json().catch(() => null);
          if (reposRes.status === 409 && reposData?.error === "multiple_repos_granted") {
            // Installs are single-repo by design (ADR 0019) - block, don't offer a pick.
            setState({ status: "auth_error", errorType: "multiple_repos_granted" });
            return;
          }
          if (!reposRes.ok || !reposData) {
            setState({ status: "auth_error", errorType: "lookup_failed" });
            return;
          }
          if (reposData.repo_full_name) {
            setState({
              status: "authenticated",
              login: data.login,
              repoFullName: reposData.repo_full_name,
            });
          } else {
            // No repo at all - setup happens in the iOS app only, so route to the
            // matching dead-end message instead of silently bouncing to login.
            setState({ status: "auth_error", errorType: reposData.reason ?? "needs_ios_setup" });
          }
        } catch {
          if (!cancelled) setState({ status: "auth_error", errorType: "lookup_failed" });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // The one failure that looks like success: a request that never reached the API leaves
        // the athlete on the login screen, indistinguishable from a normal sign-out, and the
        // API half of the trace has nothing on it. Capture before the state change, because the
        // state change is what hides it.
        captureFetchFailure("/api/auth/me", { kind: "network", error });
        setState({ status: "unauthenticated" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // One place decides who Sentry thinks is here: this is the only thing in the client that
  // learns the repo, and any state that is not `authenticated` — sign-out, an expired session,
  // a lookup failure — clears the identity rather than leaving the last athlete attached.
  useEffect(() => {
    setAthleteUser(state.status === "authenticated" ? state.repoFullName : null);
  }, [state.status, state.repoFullName]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
