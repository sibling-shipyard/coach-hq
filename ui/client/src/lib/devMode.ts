/**
 * Local dev defaults to golden-dataset + auth bypass. Set VITE_FORCE_HOSTED_AUTH=true
 * in ui/.env.local to exercise real GitHub OAuth and /api/repo-file under vercel dev.
 */
export const forceHostedAuth = import.meta.env.VITE_FORCE_HOSTED_AUTH === "true";

/** True when Vite dev server runs without forced hosted auth (default local workflow). */
export const isLocalDevBypass = import.meta.env.DEV && !forceHostedAuth;
