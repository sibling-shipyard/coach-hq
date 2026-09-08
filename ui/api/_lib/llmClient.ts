/**
 * llmClient.ts — the provider-neutral contract every LLM caller speaks, and the env-driven
 * selector that picks which adapter runs a given request.
 *
 * One adapter runs per call; there is no shadow call and no dual-send
 * (docs/plans/chat-openrouter-migration.md, locked decisions). `LLM_PROVIDER` defaults to
 * "gemini" — an unset var, or a value nobody recognizes, keeps a deployment on direct Gemini.
 * Only the exact value "openrouter" selects the other path, so flipping production is one env
 * var on one deployment, not a code change.
 */
import { createGeminiAdapter } from "./llmAdapters/geminiAdapter.js";
import { createOpenRouterAdapter } from "./llmAdapters/openRouterAdapter.js";

export type LlmProviderName = "gemini" | "openrouter";

/**
 * A strict-mode JSON Schema response shape, named the way OpenRouter's `json_schema.name` wants
 * it. `additionalProperties: false` is required for OpenRouter's strict mode; the Gemini adapter
 * drops it before sending, since Gemini's own `responseSchema` has no such field.
 */
export interface LlmJsonSchema {
  name: string;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

/**
 * One turn in a conversation, in Gemini's own role vocabulary (`"user"` | `"model"`) since that's
 * the more restrictive of the two providers' shapes — the OpenRouter adapter remaps `"model"` to
 * `"assistant"` on its way out, so callers never need to know that OpenRouter uses a different word
 * for the same thing.
 */
export interface LlmMessage {
  role: "user" | "model";
  text: string;
}

export interface LlmRequest {
  /**
   * The system instruction, separate from the conversation turns. Empty string means "none" —
   * both adapters omit the system field entirely rather than send an empty one, so a caller with
   * no natural system/user split (coach-message today) gets the exact same wire shape it always
   * sent: one user turn, no system block.
   */
  system: string;
  messages: LlmMessage[];
  maxOutputTokens: number;
  responseSchema: LlmJsonSchema;
  /** Per-request timeout in ms. Both adapters pass this straight to `fetchWithTimeout`. */
  timeoutMs: number;
}

export interface LlmTelemetry {
  adapter: LlmProviderName;
  /** The model id this adapter is configured with — fixed per adapter, not per request. */
  model: string;
  /** OpenRouter's resolved upstream provider and model. Unset for the direct Gemini adapter. */
  resolvedProvider?: string;
  resolvedModel?: string;
}

export interface LlmResult {
  /** Raw JSON text matching `responseSchema` — the caller parses and validates it. */
  text: string;
  telemetry: LlmTelemetry;
}

export interface LlmAdapter {
  readonly name: LlmProviderName;
  /** The model id this adapter always uses. Direct Gemini and OpenRouter pin separate ids. */
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResult>;
}

function resolveProviderName(env: NodeJS.ProcessEnv): LlmProviderName {
  return env.LLM_PROVIDER === "openrouter" ? "openrouter" : "gemini";
}

/**
 * Build the adapter this deployment runs. Any value other than exactly "openrouter" — unset,
 * "gemini", or a typo — selects direct Gemini, so production stays there unless a deployment
 * sets `LLM_PROVIDER=openrouter` on purpose.
 */
export function selectLlmAdapter(env: NodeJS.ProcessEnv = process.env): LlmAdapter {
  return resolveProviderName(env) === "openrouter"
    ? createOpenRouterAdapter(env)
    : createGeminiAdapter(env);
}
