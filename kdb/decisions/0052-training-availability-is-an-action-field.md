# 0052 — Training frequency is a model action field, not parsed prose

- **Status:** Accepted · 2026-09-19 · Tech Lead
- **Area:** coach-chat backend
- **Context:** the First Session asks how often the athlete trains, but no field held the answer. The model wrote it into `coach_note`, which nothing reads back. Live runs built the first week on default days.
- **Decision:** add `training_availability_update` to the reply schema, on First Session and returning turns. It writes `memory.training_availability`. Parsing the memory notes stays as the fallback.
- **Why:** every other intake fact has a field of its own, and frequency was the one exception. A field lets the model save it the same way it saves sports or style.
- **Rejected:** a reprompt guard for frequency phrases → the model ignored it twice and the reply replaced the good fields. Reading `coach_log` → one row per day, so a later same-day turn overwrites it.
- **Enforces:** a stated training frequency goes in `training_availability_update`. Do not add server-side parsing of chat text for it.
