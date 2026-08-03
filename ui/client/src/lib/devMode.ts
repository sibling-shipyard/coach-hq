/**
 * Opt-in override for AuthContext's local-dev auth bypass. Plain `npm run dev` should always
 * fake being logged in (zero-setup personal-dashboard use) - this only flips on when someone
 * is deliberately testing real GitHub OAuth/Coach Chat locally against ui/scripts/local-api-server.mjs,
 * per ui/.env.local.example. See #61.
 */
export const isLocalDevBypass = import.meta.env.DEV && import.meta.env.VITE_FORCE_HOSTED_AUTH !== "true";
