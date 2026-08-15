# 0022 — SOUL composes into two builds: one for the app, one for BYO Claude Code

- **Status:** Accepted · 2026-08-15 · Tech Lead
- **Area:** cross-cutting
- **Context:** ADR 0021 assumed the terminal / BYO-Claude coaching path was retiring, and stopped
  carving `propagated/SOUL.md`, `propagated/docs/`, `.claude/`, root `CLAUDE.md`, and
  `engine/claude/` into new athlete repos. That assumption was wrong: coach-chat is not yet
  stable, both live athletes moved *back* to BYO Claude Code, and a freshly carved repo today
  cannot run Coach at all. Meanwhile the single composed `platform/SOUL.md` ships whole to two
  runtimes with very different abilities — BYOB has a shell, git, and file reads; coach-chat has
  none, and its own system prompt tells the model to ignore any SOUL instruction it cannot
  execute (`ui/api/coach-chat.ts:585`). A line-by-line audit found roughly half of what the app
  receives falls under that instruction.
- **Decision:** `platform/scripts/compose-soul.mjs` gains a target per `ASSEMBLY` step and emits
  two artifacts from the same `platform/soul/*.md` layers: `SOUL.chat.md`, bundled by
  `ui/scripts/build-soul.mjs` for coach-chat, and `SOUL.claude.md`, carved into athlete repos for
  BYO Claude Code. CI runs `--check` on both. The bare `platform/SOUL.md` name is retired so
  neither runtime silently owns it. `SOUL.claude.md` is a **legacy target with an end date**, not
  a peer — the app becoming the only path is still the destination, after stability.
- **Why:** Layer A (identity, voice, philosophy, situation playbook) is identical for both
  runtimes and must never fork; only the engine differs. Two targets from one source bounds the
  divergence to the parts that genuinely differ, and makes the eventual removal of BYOB one line
  in the `ASSEMBLY` table instead of a fresh audit of 500 lines to find what was BYOB-only.
- **Rejected:** Freeze BYOB as a legacy copy and iterate only on the app → freezes the runtime
  both athletes actually use while polishing the one nobody does. Fork the source layers → Layer
  A would drift between runtimes, which is the one thing that must not happen. Keep one composed
  file and accept the dead weight → the app pays for ~277 lines it is explicitly told to ignore,
  and nothing catches the next instruction the backend quietly replaces.

<!-- Amends 0021, which stays Accepted: reading SOUL directly from HQ was right, and remains how
     coach-chat works. Only its premise that BYO/terminal mode was retiring is reversed here. -->
