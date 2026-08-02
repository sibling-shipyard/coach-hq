/**
 * AuthContext — gates the app on /api/auth/me.
 *
 * "local" status covers plain `npm run dev`/self-hosted single-repo use, where
 * there's no hosted auth layer at all. Keyed off Vite's own import.meta.env.DEV
 * flag, not response shape - inferring "no /api layer" from a non-JSON or
 * failed response is wrong: a genuine production error would look identical
 * and silently unlock the dashboard instead of showing a gate. Any real
 * fetch/parse failure on the hosted deployment falls back to "unauthenticated"
 * (the login screen), never "local".
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type AuthStatus = "loading" | "local" | "unauthenticated" | "authenticated" | "auth_error" | "repo_picker";

interface AuthState {
  status: AuthStatus;
  login?: string;
  repoFullName?: string | null;
  /** auth_error only - which AuthError message to show. */
  errorType?: string;
  /** repo_picker only - candidates from list-my-repos. */
  candidates?: string[];
}

const AuthContext = createContext<AuthState>({ status: "loading" });

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(
    import.meta.env.DEV ? { status: "local" } : { status: "loading" }
  );

  useEffect(() => {
    if (import.meta.env.DEV) return; // no hosted auth layer in local dev - already set above

    let cancelled = false;

    fetch("/api/auth/me")
      .then(async (res) => {
        if (cancelled) return;

        if (!res.ok) {
          setState({ status: "unauthenticated" });
          return;
        }

        const data = await res.json();
        if (data.repo_full_name) {
          setState({ status: "authenticated", login: data.login, repoFullName: data.repo_full_name });
          return;
        }

        // Session is valid but no repo resolved yet (list-my-repos is never called by
        // callback.ts itself - see ui/api/auth/callback.ts's web branch) - resolve it now.
        try {
          const reposRes = await fetch("/api/auth/list-my-repos");
          if (cancelled) return;
          if (!reposRes.ok) {
            setState({ status: "auth_error", errorType: "lookup_failed" });
            return;
          }
          const reposData = await reposRes.json();
          if (reposData.repo_full_name) {
            setState({ status: "authenticated", login: data.login, repoFullName: reposData.repo_full_name });
          } else if (Array.isArray(reposData.candidates) && reposData.candidates.length > 0) {
            setState({ status: "repo_picker", login: data.login, candidates: reposData.candidates });
          } else {
            // No repo at all - setup happens in the iOS app only, so route to the
            // matching dead-end message instead of silently bouncing to login.
            setState({ status: "auth_error", errorType: reposData.reason ?? "needs_ios_setup" });
          }
        } catch {
          if (!cancelled) setState({ status: "auth_error", errorType: "lookup_failed" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unauthenticated" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
