# 0049 — Python pipeline never imports sentry_sdk; the workflow envelope is the whole story

- **Status:** Accepted · 2026-09-16 · Tech Lead
- **Area:** pipeline
- **Context:** The post-#1078 audit found Python pipeline scripts (PY1–5) that swallow real
  faults — a corrupt history file gets dropped silently, an empty quest list exits 0, sync
  counters get hardcoded. Sync goes green while the derived data is wrong or empty. #1078's
  finishing PR skipped deciding whether Python gets its own Sentry integration before any of
  that gets fixed.
- **Decision:** Python pipeline scripts never take `sentry_sdk`, or any new pip dependency, for
  observability. `notify_sync_failure.py` and `record_sync_failure.py` already hand-build and
  send a Sentry envelope over `urllib` whenever the Sync workflow's `if: failure()` branch runs
  — any step that raises or exits nonzero is already covered. Fixing PY1–5 means making each
  script raise or exit nonzero on a real fault, not adding its own capture call.
- **Why:** The workflow-level envelope already exists and costs nothing to reuse
  (`engine/scripts/notify_sync_failure.py`); it is deliberately standard-library-only because
  the step that died can be the same one that would have installed `sentry_sdk`
  (`engine/scripts/record_sync_failure.py:4`). A dependency that only runs on the failure path
  is the one most likely to be missing exactly when it is needed.
- **Rejected:** Add `sentry_sdk` to the pipeline → a new pip dependency on the one path most
  likely to already be broken, duplicating what the workflow envelope does for free. Per-script
  custom HTTP calls to Sentry → re-implements `notify_sync_failure.py`'s envelope building once
  per script instead of reusing the one that exists.
- **Enforces:** No `sentry_sdk`, or any new pip package, in the Python pipeline for
  observability. A PY-numbered correctness fix raises or exits nonzero; it never adds its own
  Sentry call.
- **How to apply:** Fixing a PY-numbered soft-continue means replacing the silent
  drop/exit-0/hardcode with a `raise` or `sys.exit(1)` carrying a clear message. The Sync
  workflow's existing failure branch and `notify_sync_failure.py` do the rest — no other change
  needed.
