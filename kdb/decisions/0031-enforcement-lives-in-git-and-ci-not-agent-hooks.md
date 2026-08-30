# 0031 — Enforcement lives in git and CI, not agent hooks

- **Status:** Accepted · 2026-08-28 · Tech Lead
- **Area:** cross-cutting
- **Context:** This repo is worked from three tools — Claude Code, Codex and Cursor — and the
  rules that keep five agents from stepping on each other were prose in `AGENTS.md` plus two
  Claude-only hooks. Two gaps followed. `core.hooksPath` was unset and `.git/hooks/` empty. So the one
  tool-agnostic gate the repo had, `kdb/scripts/pre-commit`, sat behind a symlink documented in a
  single line of `CONVENTIONS.md`, and nobody had enabled it. CI was the only enforcement. And the routing gate that stops a session mis-booting into the wrong agent
  lives in `.claude/hooks/session-start.sh`, so under Codex and Cursor it never fires at all. A rule that holds in one
  of three tools is not a rule. #522 is what that costs: a branch cut from what looked like
  `main` inherited five commits off a detached HEAD, and the fix shipped as a paragraph.
- **Decision:** Anything load-bearing is enforced by git or CI. Mechanical rules go in
  `.githooks/` (versioned, enabled per clone with `git config core.hooksPath .githooks`); the
  rest go in a CI workflow or a row in `platform/scripts/check.sh`. Agent-specific hooks and
  settings stay allowed, but only as a strict superset — they may catch a problem earlier or
  more precisely, never exclusively. `check.sh` warns when a clone has not enabled the hooks, so
  an unconfigured checkout is loud rather than silently ungated.
- **Why:** Portability and reliability are the same property here. A git hook fires for every
  tool because every tool shells out to `git`, and a shell command cannot be forgotten by a
  compacted agent the way a paragraph in a context file can. The cost is latency: a `PreToolUse`
  hook blocks a command before it runs, while a git hook only sees the outcome at commit time.
  That is worth paying — one retry, in exchange for a rule that holds in all three tools.
- **Rejected:** Keep enforcement in `.claude/` because that is where the athlete works most →
  makes the other two tools silently ungated, which is exactly how #522 happened. Rely on CI
  alone → feedback arrives a full round trip late, and a red CI teaches people to skim.
  Require hooks via a bootstrap script agents must run → a setup step nobody runs is the
  opt-in symlink again, under a new name.
- **Enforces:** Before putting a rule in `.claude/`, ask what happens when the same repo is opened in Codex. If the answer is "nothing enforces it", it belongs in `.githooks/` or CI.
