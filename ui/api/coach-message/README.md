# `api/coach-message/` — proactive post-sync Coach message

`../coach-message.ts` is the routed handler (`POST /api/coach-message`, see
[`../README.md`](../README.md)): authenticate, resolve which synced activities the message should
cover, and generate + commit Coach's proactive message once. The internals live here.

| Path                   | Role                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_lib/coachMessage.ts` | Resolve the activity batch, build the proactive-message prompt context, run it through the LLM seam, and produce the atomic write for the latest-message file |
| `_tests/`              | Deterministic tests for `coachMessage.ts`, mocking only the network edge (LLM call, GitHub commit)                                                            |

This is a separate feature from coach-chat's own activity-sync turn
(`coach-chat/_lib/commit/activitySyncTurn.ts`): that one writes a committed chat thread inside a
real Coach conversation, while `coach-message` writes a standalone proactive message an athlete
sees without opening chat.
