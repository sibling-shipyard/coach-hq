# `api/coach-message/` — proactive post-sync Coach message

`../coach-message.ts` is the routed handler (`POST /api/coach-message`, see
[`../README.md`](../README.md)): authenticate, resolve which synced activities the message should
cover, and generate + commit Coach's proactive message once. The internals live here.

| Path                       | Role                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_lib/activityRequest.ts`  | Request-side parsing and validation: the recursive GitHub activity-tree read, `activity_ids` payload validation, and the generated-body shape check                           |
| `_lib/proactiveContext.ts` | Builds the `ProactiveContext` the prompt runs on: projects the athlete/activity/insight files into the athlete-context shape, and parses the latest-message file              |
| `_lib/coachMessage.ts`     | The entry point other code imports from: builds the prompt from a `ProactiveContext`, runs it through the LLM seam, and produces the atomic write for the latest-message file |
| `_tests/`                  | Deterministic tests for `_lib/`, mocking only the network edge (LLM call, GitHub commit)                                                                                      |

This is a separate feature from coach-chat's own activity-sync turn
(`coach-chat/_lib/commit/activitySyncTurn.ts`): that one writes a committed chat thread inside a
real Coach conversation, while `coach-message` writes a standalone proactive message an athlete
sees without opening chat.
