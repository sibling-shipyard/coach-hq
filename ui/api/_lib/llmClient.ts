/**
 * llmClient.ts - the provider-neutral contract every LLM caller speaks, and the env-driven
 * selector that picks which adapter runs a given request.
 *
 * One adapter runs per call; there is no shadow call and no dual-send
 * (docs/plans/chat-openrouter-migration.md, locked decisions). `LLM_PROVIDER` defaults to
 * "gemini" - an unset var, or a value nobody recognizes, keeps a deployment on direct Gemini.
 * Only the exact value "openrouter" selects the other path, so flipping production is one env
 * var on one deployment, not a code change.
 */
import { createGeminiAdapter } from "./llmAdapters/geminiAdapter.js";
import { createOpenRouterAdapter } from "./llmAdapters/openRouterAdapter.js";

export type LlmProviderName = "gemini" | "openrouter";

/**
 * One property (or nested schema) inside a strict-mode JSON Schema response. OpenRouter's strict
 * mode requires `additionalProperties: false` at *every* object nesting level, not just the top
 * one (docs/plans/openrouter-m2-chat-lld.md's #713 M2 probe confirmed this model/provider accepts
 * optional properties, so the "required" side of strict mode doesn't apply here — only this one).
 * Annotate a raw schema object literal with `LlmJsonSchemaNode` (or the object-only
 * `LlmJsonSchemaObjectNode`) and the compiler flags every object missing the field, at any depth —
 * that's the actual mechanism, not a promise kept by hand.
 */
export type LlmJsonSchemaNode =
  | { type: "string"; enum?: readonly string[]; maxLength?: number }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "array"; items: LlmJsonSchemaNode }
  | LlmJsonSchemaObjectNode;

export interface LlmJsonSchemaObjectNode {
  type: "object";
  properties: Record<string, LlmJsonSchemaNode>;
  required?: readonly string[];
  additionalProperties: false;
}

/**
 * A strict-mode JSON Schema response shape, named the way OpenRouter's `json_schema.name` wants
 * it. `additionalProperties: false` is required for OpenRouter's strict mode; the Gemini adapter
 * drops it before sending, since Gemini's own `responseSchema` has no such field.
 */
export interface LlmJsonSchema {
  name: string;
  schema: {
    type: "object";
    properties: Record<string, LlmJsonSchemaNode>;
    required: string[];
    additionalProperties: false;
  };
}

/**
 * One turn in a conversation, in Gemini's own role vocabulary (`"user"` | `"model"`) since that's
 * the more restrictive of the two providers' shapes - the OpenRouter adapter remaps `"model"` to
 * `"assistant"` on its way out, so callers never need to know that OpenRouter uses a different word
 * for the same thing.
 */
export interface LlmMessage {
  role: "user" | "model";
  text: string;
}

export interface LlmRequest {
  /**
   * The system instruction, separate from the conversation turns. Empty string means "none" -
   * both adapters omit the system field entirely rather than send an empty one, so a caller with
   * no natural system/user split (coach-message today) gets the exact same wire shape it always
   * sent: one user turn, no system block.
   */
  system: string;
  /**
   * The fully stable, explicitly-cacheable prefix (coach-chat's persona + fixed instructions +
   * few-shots) — absent for a caller with no such prefix (coach-message, template adjustment).
   * Callers pass this and never learn whether it actually got cached; that's the adapter's
   * business (docs/plans/openrouter-m2-chat-lld.md, "What the seam has to grow" #2). The Gemini
   * adapter tries its explicit soul cache for this text and, on a hit, moves `system` into
   * `contents` instead (Gemini rejects `cachedContent` + `systemInstruction` together); on a miss
   * it concatenates `cachePrefix + "\n" + system` into one `systemInstruction`, byte-identical to
   * the pre-#713 cache-inactive path. The OpenRouter adapter never has an active cache — it always
   * concatenates the same way, since `cachePrefix` is otherwise inert there (locked decision:
   * OpenRouter owns its own caching, its adapter does not emulate Gemini cache names). Presence of
   * this field (not whether the cache actually hit) is also what gates the Gemini adapter's
   * retry-on-400/503/504 — a caller with no cache prefix (coach-message) gets no retry, matching
   * its pre-#713 behavior exactly.
   */
  cachePrefix?: string;
  messages: LlmMessage[];
  maxOutputTokens: number;
  responseSchema: LlmJsonSchema;
  /** Per-request timeout in ms. Both adapters pass this straight to `fetchWithTimeout`. */
  timeoutMs: number;
}

export interface LlmTelemetry {
  adapter: LlmProviderName;
  /** The model id this adapter is configured with - fixed per adapter, not per request. */
  model: string;
  /** OpenRouter's resolved upstream provider and model. Unset for the direct Gemini adapter. */
  resolvedProvider?: string;
  resolvedModel?: string;
}

export interface LlmResult {
  /** Raw JSON text matching `responseSchema` - the caller parses and validates it. */
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
 * Build the adapter this deployment runs. Any value other than exactly "openrouter" - unset,
 * "gemini", or a typo - selects direct Gemini, so production stays there unless a deployment
 * sets `LLM_PROVIDER=openrouter` on purpose.
 */
export function selectLlmAdapter(env: NodeJS.ProcessEnv = process.env): LlmAdapter {
  return resolveProviderName(env) === "openrouter"
    ? createOpenRouterAdapter(env)
    : createGeminiAdapter(env);
}
