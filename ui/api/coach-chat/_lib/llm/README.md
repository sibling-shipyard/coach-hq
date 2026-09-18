# `_lib/llm/` — the LLM boundary

This is coach-chat's provider-agnostic dispatch layer. Gemini-specific adapter
logic lives behind the shared seam. `coachLlmClient.ts`'s own header comment explains it: request construction
(static/dynamic prompt split, history mapping, schema selection) lives here, then the call runs
through the shared seam (`selectLlmAdapter` in [`../../../_lib/llmClient.ts`](../../../_lib/llmClient.ts))
like every other LLM caller in this codebase. The explicit soul cache, the retry-on-400/503/504
logic, and the actual HTTP call live behind that seam, in `../../../_lib/llmAdapters/geminiAdapter.ts`,
not in this folder.

| File                  | Responsibility                                                                  |
| --------------------- | ------------------------------------------------------------------------------- |
| `coachLlmClient.ts`   | Build the prompt/request, run it through the seam, parse the reply              |
| `coachPromptText.ts`  | Static cached prefix, dynamic mode instructions, history window, context blocks |
| `coachReplySchema.ts` | `LlmReply`, `TurnMode`, and the mode-specific structured-output schemas         |

`coachPromptText.ts` may import the `TurnMode` type from `coachReplySchema.ts`; the schema module
must not depend on prompt text.

The folder and its client names describe the provider-agnostic boundary; direct Gemini
transport remains in the adapter layer described above.

See [`../../README.md`](../../README.md) for the full turn-flow diagram this fits into.
