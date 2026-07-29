/**
 * AuthContext — gates the app on /api/auth/me.
 *
 * "local" status covers plain `npm run dev`/self-hosted single-repo use, where
 * there's no hosted auth layer at all. Keyed off Vite's import.meta.env.DEV
 * flag unless VITE_FORCE_HOSTED_AUTH=true (see ui/.env.local.example), not response shape - inferring "no /api layer" from a non-JSON or
 * failed response is wrong: a genuine production error would look identical
 * and silently unlock the dashboard instead of showing a gate. Any real
 * fetch/parse failure on the hosted deployment falls back to "unauthenticated"
 * (the login screen), never "local".
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isLocalDevBypass } from "../lib/devMode";

export type AuthStatus = "loading" | "local" | "unauthenticated" | "onboarding" | "authenticated";

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
    isLocalDevBypass ? { status: "local" } : { status: "loading" }
  );

  useEffect(() => {
    if (isLocalDevBypass) return; // no hosted auth layer in local dev - already set above

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
          setState({ status: "onboarding", login: data.login });
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
