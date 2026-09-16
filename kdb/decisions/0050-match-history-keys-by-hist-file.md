# 0050 — Match history keys each session by its history file

- **Status:** Accepted · 2026-09-16 · Tech Lead
- **Area:** cross-cutting (iOS, pipeline, web)
- **Narrows:** ADR 0013 keeps `match_history.json` canonical and iOS as its parser. ADR 0035 keeps one `hist/` file per real session.
- **Context:** iOS replaces every match entry with the same date. Two badminton sessions on one day overwrite each other, and Python analytics also collapses them when it joins by date.
- **Decision:** New match entries carry optional `historyFile`: the exact basename, including `.json`, of their committed `user_data/activities/hist/` file. iOS upserts by that value. Consumers join keyed entries to that file; `date` remains a display and legacy fallback field.
- **Why:** The committed history file already names one real session. Its first UUID stays fixed through a Garmin rewrite, so the same key reaches iOS, Python, and web without a second identity store.
- **Rejected:** Date as key → same-day collisions · Current HealthKit UUID as key → Garmin rewrites change it and older Strava files may not have one · Reparse descriptions → breaks ADR 0013's single parser.
- **Enforces:** Never replace or collapse match entries merely because their dates agree.
- **How to apply:** Leave old entries without `historyFile` readable by date. A new save never replaces one by date alone; only a trusted source key can prove identity. Do not bulk-rewrite athlete history to add keys.
