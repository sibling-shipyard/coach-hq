# 0022 — SOUL composes into two builds: one for the app, one for BYO Claude Code

- **Status:** Accepted · 2026-08-15 · Tech Lead
- **Area:** cross-cutting
- **Context:** SOUL used to be one composed file, copied into every athlete repo and re-fetched
  from that repo on every coach-chat turn. That is a network call per turn for a value that never
  varies by athlete, and it meant a coach-behaviour edit could not land until the next carve.
  ADR 0021 fixed the fetch, but also assumed BYO Claude Code was retiring and stopped carving the
  files it needs.
  That assumption was wrong within ten days: both live athletes moved back to BYOB, and a freshly
  carved repo could not run Coach at all. The two runtimes are also not alike. BYOB has a shell,
  git and file reads; the hosted app has none, and its own system prompt tells the model to ignore
  any SOUL instruction it cannot execute. An audit found roughly half the file fell under that.
- **Decision:** `platform/scripts/compose-soul.mjs` emits two artifacts from the same
  `platform/soul/*.md` layers. `SOUL.chat.md` is bundled into the hosted backend at build time by
  `ui/scripts/build-soul.mjs` and never leaves HQ. `SOUL.claude.md` is carved into athlete repos
  for BYOB. CI runs `--check` on both. The bare `SOUL.md` name is retired so neither runtime
  silently owns it.
- **Why:** Layer A — identity, voice, philosophy — is identical for both runtimes and must never
  fork; only the engine layer differs. Two targets from one source bound the divergence to the
  part that genuinely differs, and make retiring BYOB one row in the `ASSEMBLY` table rather than
  a fresh audit of 500 lines.
- **Rejected:** Freeze BYOB as a legacy copy and iterate only on the app → freezes the runtime
  both athletes actually use, to polish the one nobody does · Fork the source layers → Layer A
  would drift, which is the one thing that must not happen · Keep one composed file → the app
  pays for ~277 lines it is told to ignore, and nothing catches the next instruction the backend
  quietly overrides.
- **Enforces:** Never hand-edit a composed SOUL, and never add a third artifact. A runtime
  difference belongs in the `ASSEMBLY` table, not in a forked layer.
- **How to apply:** Edit `platform/soul/*.md`, run `node platform/scripts/compose-soul.mjs`, then
  commit the layers with both regenerated builds. `SOUL.claude.md` is a legacy target with an end
  date, not a peer.
