# Sentry observability — LLD

> Status: Current · Owner: Tech Lead · Verified: 2026-08-26 · ADR: 0031

Low-level design for error capture, LLM telemetry, and local diagnostic timelines across web, API, and iOS.

## 1. Context

Four beta athletes use the product; Sentry provides a single, searchable debugging trail across clients and backend functions without relying on memory or raw cloud logs.

## 2. Decision / goal

```mermaid
flowchart LR
  W["Web client /ui"] -->|scrubbed errors| S["Sentry (EU/Germany)<br/>30-day retention"]
  A["Vercel API /api"] -->|errors + LLM telemetry| S
  I["iOS App"] -->|crashes + opt-in reports| S
  I -->|ring buffer (200 events)| T["Local timeline (24h)"]
```

### Event schemas and tags

| Scope | Tag / Field | Type | Description / Example |
|---|---|---|---|
| **Common** | `release` | string | `git-sha` or semantic version (e.g. `2026.08.26+sha`) |
| **Common** | `environment` | string | `production`, `preview`, or `development` |
| **Common** | `athlete_id` | string | GitHub login / athlete handle (beta cohort only) |
| **Common** | `operation_id` | UUID | Generated per client interaction; joined across web, API, and LLM |
| **Web & API** | `model` | string | Gemini model name (e.g. `gemini-2.5-pro`, `gemini-2.5-flash`) |
| **Web & API** | `prompt_tokens` / `completion_tokens` | number | Exact token counts returned by Gemini API |
| **Web & API** | `athlete_message` / `gemini_reply` | string | Text exchange for the failed/traced turn |
| **iOS** | `app_version` / `build_number` | string | Client version and CFBundleVersion |
| **iOS** | `view_name` | string | Active screen or sheet (e.g. `HomeView`, `CoachChatView`) |
| **iOS** | `timeline_excerpt` | JSON | Last ≤200 local diagnostic events (attached on problem report) |

### Credential scrubbing rules

All Sentry SDK integrations (browser SDK, Node/Vercel SDK, Swift SDK) must run `beforeSend` scrubbing:

1. **Headers & cookies:** Strip `Authorization`, `Cookie`, `Set-Cookie`, `x-github-token`, and `x-session-token`.
2. **Secrets & tokens:** Redact any string matching `ghp_[A-Za-z0-9_]{36,}`, `AIza[0-9A-Za-z-_]{35}`, or JWT tokens (`Bearer eyJ...`).
3. **Private credentials:** Redact `GEMINI_API_KEY`, `SESSION_SECRET`, and `GITHUB_APP_CLIENT_SECRET`.

### Storage & retention bounds

- **Sentry (Server):** Max 30 days retention. Stored in Sentry Developer Germany region.
- **Local iOS timeline:** In-memory + local cache ring buffer capped at 200 events or 256 KiB. Evicted after 24 hours or immediately on user sign-out.
- **Beta cohort:** 4 current beta athletes opted in by default; automatic replay/screen capture remains disabled.

## 3. Done when

1. Sentry projects configured for Web, API, and iOS under the EU/Germany data boundary.
2. Web and API errors capture `operation_id`, `release`, and Gemini LLM metadata (`model`, token counts, message snippet).
3. Secret scrubbers verify zero auth headers or API keys escape to Sentry events.
4. iOS crashes capture thread backtraces and active view name; problem reports attach the local timeline.

## 4. Deferred

- Athlete privacy preferences and opt-out UI toggles ([#590](https://github.com/sibling-shipyard/coach-hq/issues/590)).
- Automatic session recording / screen replays (deferred indefinitely).
- Long-term log warehousing beyond the 30-day Sentry window.
