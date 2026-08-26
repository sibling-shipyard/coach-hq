# 0021 — coach-chat reads SOUL.md directly from HQ; terminal/BYO-Claude coaching mode retired

- **Status:** Accepted · 2026-08-05 · Tech Lead · **BYO-retirement premise reversed by [0022](0022-two-composed-soul-builds.md)** — reading SOUL from HQ still stands, but BYO Claude Code was not retired: both live athletes moved back to it and carve ships `SOUL.claude.md`, `.claude/` and `CLAUDE.md` again. Do not read this ADR without 0022.
- **Area:** cross-cutting
- **Context:** ADR 0011 assumed SOUL reaches an athlete only via carve-and-propagate
  (`platform/SOUL.md` → composed → copied byte-for-byte into every athlete's
  `propagated/SOUL.md`), and that every athlete repo carries a local/BYO Claude Code coaching
  path (`engine/claude/`, `.claude/`, root `CLAUDE.md`). SOUL.md is verified 100% generic — no
  per-athlete substitution happens anywhere in the carve process — but was still being re-fetched
  from each athlete's own GitHub repo on every single coach-chat turn (one GitHub API call/turn,
  times every athlete), and a coach-behavior edit wouldn't reach an athlete's chat until their
  next carve. Separately: every real athlete (currently skanda and akash) now talks to Coach
  exclusively through the hosted coach-chat web/iOS app — nobody uses the terminal/BYO-Claude
  path anymore.
- **Decision:** The coach-chat backend (`ui/api/coach-chat.ts`, an HQ-owned Vercel function in
  this same monorepo) now bundles `platform/SOUL.md` directly at build time
  (`ui/scripts/build-soul.mjs`, generates `ui/api/_generated/soul.ts`) instead of fetching
  `propagated/SOUL.md` from the athlete's repo. The `coach-skeleton` carve template
  (`platform/scripts/carve-skeleton.mjs`) stops writing `propagated/SOUL.md`, `propagated/docs/`,
  `.claude/`, root `CLAUDE.md`, and `engine/claude/` — terminal/BYO-Claude coaching is retired
  from new athlete repos going forward. The two existing live athlete repos (`coach-skanda`,
  `coach-akash`) keep those files for now — deletion there is tracked in a follow-up GitHub issue,
  not done in this pass, since coach-chat is still stabilizing and terminal mode is the fallback
  until it's confirmed stable.
- **Why:** A pure constant shouldn't be re-fetched over the network from N different repos every
  turn, and shouldn't need a carve to propagate a behavior change. Retiring the coaching path
  nobody uses removes the only reason athlete repos needed a SOUL copy or Claude config at all,
  rather than leaving both a "read from HQ" path and a "read from athlete repo" path that could
  drift or be read interchangeably by accident.
- **Rejected:** Keep propagating SOUL to athlete repos "just in case" a terminal-mode athlete
  shows up later → no such athlete exists today, and re-adding the carve step is cheap whenever
  one does; carrying dead weight in every athlete repo in the meantime isn't worth it. Delete the
  terminal-mode files from the two live athlete repos immediately → deferred instead (tracked
  issue) since coach-chat isn't yet confirmed as a full replacement in production use.

<!-- Write in plain English — short words, no jargon. Someone outside the team
     should understand it. Keep each field to a line or two. -->
