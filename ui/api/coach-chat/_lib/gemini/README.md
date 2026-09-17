# `_lib/gemini/` — the Gemini boundary

Despite the folder name, this is coach-chat's provider-agnostic dispatch layer, not
Gemini-specific code. `geminiClient.ts`'s own header comment explains it: request construction
(static/dynamic prompt split, history mapping, schema selection) lives here, then the call runs
through the shared seam (`selectLlmAdapter` in [`../../../_lib/llmClient.ts`](../../../_lib/llmClient.ts))
like every other LLM caller in this codebase. The explicit soul cache, the retry-on-400/503/504
logic, and the actual HTTP call live behind that seam, in `../../../_lib/llmAdapters/geminiAdapter.ts`,
not in this folder.

| File                  | Responsibility                                                                  |
| --------------------- | ------------------------------------------------------------------------------- |
| `geminiClient.ts`     | Build the prompt/request, run it through the seam, parse the reply              |
| `coachPromptText.ts`  | Static cached prefix, dynamic mode instructions, history window, context blocks |
| `coachReplySchema.ts` | `GeminiReply`, `TurnMode`, and the mode-specific structured-output schemas      |

`coachPromptText.ts` may import the `TurnMode` type from `coachReplySchema.ts`; the schema module
must not depend on prompt text.

A rename of this folder to `_lib/llm/` (and `geminiClient.ts`/`askGemini` to non-Gemini names) is
planned separately in `docs/plans/gemini-to-llm-rename.md` — not done here.

See [`../../README.md`](../../README.md) for the full turn-flow diagram this fits into.
