# `_lib/commit/` — the activity-sync commit path

Handles the one turn type that isn't triggered by an athlete message: a verified activity sync.
`activitySyncTurn.ts` is a persist-on-sync Coach turn — it runs the same decide -> write -> commit
shape as an ordinary chat turn (see the flow diagram in [`../../README.md`](../../README.md)), but
starts from a synced activity batch instead of user input, and commits one thread per verified
batch rather than per message.

| File                  | Responsibility                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `activitySyncTurn.ts` | Build context, call the LLM seam, assemble writes, and commit atomically for a sync-triggered turn |

The ordinary chat turn's own orchestration (`turnRequest.ts`, `requestCoachReply.ts`,
`buildTurnWrites.ts`, `turnCompletion.ts`) lives one level up in `_lib/`, not here — this folder
is specifically the sync-triggered path.
