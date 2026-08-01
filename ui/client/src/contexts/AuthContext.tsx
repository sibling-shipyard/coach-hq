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

export type AuthStatus = "loading" | "local" | "unauthenticated" | "authenticated";

interface AuthState {
  status: AuthStatus;
  login?: string;
  repoFullName?: string | null;
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
        if (!data.repo_full_name) {
          // No repo yet - setup now happens in the iOS app only, so there's no web
          // onboarding flow to route into. Fall back to the login screen.
          setState({ status: "unauthenticated" });
        } else {
          setState({ status: "authenticated", login: data.login, repoFullName: data.repo_full_name });
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
