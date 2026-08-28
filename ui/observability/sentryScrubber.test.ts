import { describe, expect, it } from "vitest";
import { scrubSentryEvent } from "./sentryScrubber.js";

describe("scrubSentryEvent", () => {
  it("removes credential headers regardless of case", () => {
    const result = scrubSentryEvent({
      request: {
        headers: {
          Authorization: "Bearer secret",
          COOKIE: "session=secret",
          "Set-Cookie": "refresh=secret",
          "x-github-token": "github-secret",
          "X-Session-Token": "session-secret",
          Accept: "application/json",
        },
      },
    });

    expect(result.request.headers).toEqual({
      Authorization: "[Filtered]",
      COOKIE: "[Filtered]",
      "Set-Cookie": "[Filtered]",
      "x-github-token": "[Filtered]",
      "X-Session-Token": "[Filtered]",
      Accept: "application/json",
    });
  });

  it("removes raw GitHub, Gemini, JWT, and configured secret values from nested strings", () => {
    const github = `ghp_${"a".repeat(36)}`;
    const fineGrainedGithub = `github_pat_${"z".repeat(40)}`;
    const gemini = `AIza${"B".repeat(35)}`;
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature";
    const configured = "private-session-secret";
    const result = scrubSentryEvent(
      {
        exception: {
          values: [
            {
              value: `github=${github} fine=${fineGrainedGithub} gemini=${gemini}`,
            },
          ],
        },
        extra: {
          nested: [{ deeper: `Bearer ${jwt}; secret=${configured}` }],
          SESSION_SECRET: configured,
        },
      },
      [configured],
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(github);
    expect(serialized).not.toContain(fineGrainedGithub);
    expect(serialized).not.toContain(gemini);
    expect(serialized).not.toContain(jwt);
    expect(serialized).not.toContain(configured);
    expect(result.extra.SESSION_SECRET).toBe("[Filtered]");
  });

  it("scrubs deeply nested credential keys without mutating the source event", () => {
    const source = {
      breadcrumbs: [
        {
          data: {
            request: {
              body: { GEMINI_API_KEY: "secret", safe: "kept" },
            },
          },
        },
      ],
    };

    const result = scrubSentryEvent(source);

    expect(result.breadcrumbs[0].data.request.body).toEqual({
      GEMINI_API_KEY: "[Filtered]",
      safe: "kept",
    });
    expect(source.breadcrumbs[0].data.request.body.GEMINI_API_KEY).toBe("secret");
  });

  it("keeps a GEMINI_API_KEY out of a captured Gemini failure", () => {
    // The two places a Gemini key can ride into an event: the request URL carries it as
    // `?key=`, and `finishGeminiResponse` puts the raw upstream body into the error message,
    // which Google echoes the key back in.
    const apiKey = `AIza${"C".repeat(35)}`;
    const upstreamBody = JSON.stringify({
      error: { message: `API key not valid: ${apiKey}`, status: "INVALID_ARGUMENT" },
    });
    const event = {
      exception: {
        values: [
          { value: `Gemini request failed (400): ${upstreamBody}` },
          {
            stacktrace: {
              frames: [
                {
                  filename: "geminiClient.ts",
                  vars: {
                    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
                  },
                },
              ],
            },
          },
        ],
      },
      contexts: { coach_turn: { athlete_message: "legs felt heavy" } },
      request: { query_string: `key=${apiKey}` },
    };

    const scrubbed = scrubSentryEvent(event, [apiKey]);

    expect(JSON.stringify(scrubbed)).not.toContain(apiKey);
    expect(JSON.stringify(scrubbed)).not.toContain("AIza");
    // The deliberate ADR 0032 payload survives - scrubbing removes credentials, not the record.
    expect(scrubbed.contexts.coach_turn.athlete_message).toBe("legs felt heavy");
  });

  it("keeps a Gemini key that does not match the AIza shape out via the configured secret", () => {
    // The pattern is a backstop, not the guarantee: a key issued in another shape is caught
    // only because initServerMonitoring passes process.env.GEMINI_API_KEY per event.
    const apiKey = "gemini-key-in-some-other-shape";
    const event = { exception: { values: [{ value: `failed with key=${apiKey}` }] } };

    expect(JSON.stringify(scrubSentryEvent(event, [apiKey]))).not.toContain(apiKey);
    expect(JSON.stringify(scrubSentryEvent(event, []))).toContain(apiKey);
  });

  it("terminates safely when an event contains a circular reference", () => {
    const source: Record<string, unknown> = { safe: "kept" };
    source.circular = source;

    expect(scrubSentryEvent(source)).toEqual({
      safe: "kept",
      circular: "[Filtered]",
    });
  });
});
