const FILTERED = "[Filtered]";

const CREDENTIAL_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-github-token",
  "x-session-token",
  "gemini_api_key",
  "session_secret",
  "github_app_client_secret",
]);

const TOKEN_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9_]{36,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /\bBearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
];

export function scrubCredentialString(
  value: string,
  privateCredentials: readonly string[] = [],
): string {
  let scrubbed = value;
  for (const pattern of TOKEN_PATTERNS) scrubbed = scrubbed.replace(pattern, FILTERED);
  for (const credential of privateCredentials) {
    if (credential) scrubbed = scrubbed.split(credential).join(FILTERED);
  }
  return scrubbed;
}

function scrubValue(
  value: unknown,
  privateCredentials: readonly string[],
  seen: WeakSet<object>,
): unknown {
  if (typeof value === "string") return scrubCredentialString(value, privateCredentials);
  if (value == null || typeof value !== "object") return value;
  if (seen.has(value)) return FILTERED;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, privateCredentials, seen));
  }

  const scrubbed: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    scrubbed[key] = CREDENTIAL_KEYS.has(key.toLowerCase())
      ? FILTERED
      : scrubValue(nested, privateCredentials, seen);
  }
  return scrubbed;
}

/** Returns a scrubbed copy so the same policy can guard browser and server events. */
export function scrubSentryEvent<T>(event: T, privateCredentials: readonly string[] = []): T {
  return scrubValue(event, privateCredentials, new WeakSet()) as T;
}
