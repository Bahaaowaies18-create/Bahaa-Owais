import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import {
  anthropicStreamFrames,
  chatResponse,
  createMockUpstream,
  jsonResponse,
  type MockHandler,
  modelsResponse,
  openAIStreamFrames,
  parseSSEPayload,
  sseResponse,
} from "./helpers/mockUpstream.js";

const BASE_ENV = {
  LOG_LEVEL: "silent",
  GROQ_API_KEY: "groq-key",
  OPENAI_API_KEY: "openai-key",
  ANTHROPIC_API_KEY: "anthropic-key",
};

const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const OPENAI_MODELS = ["gpt-5", "gpt-5-mini", "llama-3.3-70b-versatile"];
const ANTHROPIC_MODELS = ["claude-sonnet-4-5", "claude-haiku-4-5"];

/** Wire up a gateway whose providers are all served by the mock upstream. */
function makeGateway(
  handlers: {
    groq?: MockHandler;
    openai?: MockHandler;
    anthropic?: MockHandler;
  } = {},
  env: Record<string, string> = {},
) {
  const upstream = createMockUpstream({
    "api.groq.com/openai/v1/models": () => modelsResponse(GROQ_MODELS),
    "api.openai.com/v1/models": () => modelsResponse(OPENAI_MODELS),
    "api.anthropic.com/v1/models": () => modelsResponse(ANTHROPIC_MODELS),
    "api.groq.com": handlers.groq ?? (() => chatResponse("from groq")),
    "api.openai.com": handlers.openai ?? (() => chatResponse("from openai")),
    "api.anthropic.com":
      handlers.anthropic ??
      (() =>
        jsonResponse({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "claude-mock",
          content: [{ type: "text", text: "from anthropic" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 11, output_tokens: 4 },
        })),
  });

  return {
    upstream,
    build: () =>
      buildServer({ env: { ...BASE_ENV, ...env }, fetchImpl: upstream.fetchImpl }),
  };
}

const openServers: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map((s) => s.close()));
});

async function start(build: () => Promise<FastifyInstance>) {
  const app = await build();
  openServers.push(app);
  return app;
}

const USER_MESSAGE = { role: "user", content: "hello" };

describe("POST /v1/chat/completions", () => {
  it("routes a bare model to the preferred free provider", async () => {
    const { build, upstream } = makeGateway();
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-omniroute-provider"]).toBe("groq");
    expect(res.headers["x-omniroute-route"]).toBe("discovered");
    expect(res.json().choices[0].message.content).toBe("from groq");
    expect(upstream.chatCalls).toHaveLength(1);
    expect(upstream.chatCalls[0]!.headers.authorization).toBe("Bearer groq-key");
  });

  it("reports the model the client asked for, not the upstream alias", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "groq/llama-3.1-8b-instant", messages: [USER_MESSAGE] },
    });
    expect(res.json().model).toBe("groq/llama-3.1-8b-instant");
  });

  it("falls back to the next provider on a 500", async () => {
    const { build, upstream } = makeGateway({
      groq: () => jsonResponse({ error: { message: "kaboom" } }, 500),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-omniroute-provider"]).toBe("openai");
    expect(res.headers["x-omniroute-attempts"]).toBe("2");
    expect(res.json().choices[0].message.content).toBe("from openai");
    expect(upstream.chatCalls).toHaveLength(2);
  });

  it("falls back on a 429 and honours Retry-After", async () => {
    const { build } = makeGateway({
      groq: () =>
        new Response(JSON.stringify({ error: { message: "slow down" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "30" },
        }),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });
    expect(res.headers["x-omniroute-provider"]).toBe("openai");

    // Groq is now held open, so the next request skips straight to OpenAI.
    const health = await app.inject({ method: "GET", url: "/admin/providers" });
    const groq = health.json().active.find((p: { id: string }) => p.id === "groq");
    expect(groq.healthy).toBe(false);
  });

  it("does not retry elsewhere on a 400", async () => {
    const { build, upstream } = makeGateway({
      groq: () => jsonResponse({ error: { message: "bad temperature" } }, 400),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain("bad temperature");
    expect(upstream.chatCalls).toHaveLength(1);
  });

  it("gives up with a 502 when every provider fails", async () => {
    const { build } = makeGateway({
      groq: () => jsonResponse({ error: { message: "down" } }, 503),
      openai: () => jsonResponse({ error: { message: "also down" } }, 503),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("all_providers_failed");
    expect(res.json().error.details).toHaveLength(2);
  });

  it("stops after maxAttempts providers", async () => {
    const { build, upstream } = makeGateway(
      {
        groq: () => jsonResponse({ error: { message: "down" } }, 503),
        openai: () => jsonResponse({ error: { message: "down" } }, 503),
      },
      { MAX_ATTEMPTS: "1", FALLBACK_FOR_PINNED_MODELS: "true" },
    );
    const app = await start(build);

    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });
    expect(upstream.chatCalls).toHaveLength(1);
  });

  it("translates for an Anthropic-wire provider", async () => {
    const { build, upstream } = makeGateway();
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "claude-sonnet-4-5",
        messages: [
          { role: "system", content: "Be terse." },
          USER_MESSAGE,
        ],
        max_tokens: 100,
      },
    });

    expect(res.statusCode).toBe(200);
    const sent = upstream.chatCalls[0]!;
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent.headers["x-api-key"]).toBe("anthropic-key");
    expect(sent.headers["anthropic-version"]).toBe("2023-06-01");
    expect(sent.body).toMatchObject({
      model: "claude-sonnet-4-5",
      system: "Be terse.",
      max_tokens: 100,
    });

    const body = res.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("from anthropic");
    expect(body.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 4,
      total_tokens: 15,
    });
  });

  it("rejects a request with no model", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { messages: [USER_MESSAGE] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("missing_model");
  });

  it("rejects a request with no messages", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "gpt-5" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("missing_messages");
  });

  it("404s a model no provider serves", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    await app.inject({ method: "GET", url: "/v1/models" });
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "totally-made-up", messages: [USER_MESSAGE] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("model_not_found");
  });
});

describe("streaming", () => {
  it("streams an OpenAI-dialect provider through unchanged", async () => {
    const { build } = makeGateway({
      groq: () => sseResponse(openAIStreamFrames(["Hel", "lo"])),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "llama-3.3-70b-versatile",
        messages: [USER_MESSAGE],
        stream: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSSEPayload(res.payload);
    expect(events.at(-1)!.data).toBe("[DONE]");

    const text = events
      .filter((e) => e.data !== "[DONE]")
      .map((e) => JSON.parse(e.data).choices[0]?.delta?.content ?? "")
      .join("");
    expect(text).toBe("Hello");
  });

  it("translates an Anthropic-dialect stream into OpenAI chunks", async () => {
    const { build } = makeGateway({
      anthropic: () => sseResponse(anthropicStreamFrames(["Hi", " there"])),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "claude-sonnet-4-5",
        messages: [USER_MESSAGE],
        stream: true,
      },
    });

    const events = parseSSEPayload(res.payload).filter((e) => e.data !== "[DONE]");
    const text = events
      .map((e) => JSON.parse(e.data).choices[0]?.delta?.content ?? "")
      .join("");
    expect(text).toBe("Hi there");
    const finish = events
      .map((e) => JSON.parse(e.data))
      .find((c) => c.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe("stop");
  });

  it("falls back to another provider when the first fails before any token", async () => {
    const { build, upstream } = makeGateway({
      groq: () => jsonResponse({ error: { message: "overloaded" } }, 503),
      openai: () => sseResponse(openAIStreamFrames(["ok"])),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "llama-3.3-70b-versatile",
        messages: [USER_MESSAGE],
        stream: true,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-omniroute-provider"]).toBe("openai");
    expect(upstream.chatCalls).toHaveLength(2);
    expect(res.payload).toContain("[DONE]");
  });

  it("falls back when a provider opens a stream but sends nothing", async () => {
    const { build } = makeGateway({
      groq: () => sseResponse([]),
      openai: () => sseResponse(openAIStreamFrames(["recovered"])),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "llama-3.3-70b-versatile",
        messages: [USER_MESSAGE],
        stream: true,
      },
    });

    expect(res.headers["x-omniroute-provider"]).toBe("openai");
    expect(res.payload).toContain("recovered");
  });

  it("falls back when the first frame is an error event", async () => {
    const { build } = makeGateway({
      groq: () =>
        sseResponse([
          JSON.stringify({ error: { message: "upstream exploded" } }),
        ]),
      openai: () => sseResponse(openAIStreamFrames(["recovered"])),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "llama-3.3-70b-versatile",
        messages: [USER_MESSAGE],
        stream: true,
      },
    });

    expect(res.headers["x-omniroute-provider"]).toBe("openai");
    expect(res.payload).toContain("recovered");
  });

  it("returns a normal JSON error when every provider fails to start a stream", async () => {
    const { build } = makeGateway({
      groq: () => jsonResponse({ error: { message: "down" } }, 503),
      openai: () => jsonResponse({ error: { message: "down" } }, 503),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: {
        model: "llama-3.3-70b-versatile",
        messages: [USER_MESSAGE],
        stream: true,
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json().error.code).toBe("all_providers_failed");
  });
});

describe("POST /v1/messages", () => {
  it("serves an Anthropic-shaped response from an OpenAI provider", async () => {
    const { build, upstream } = makeGateway();
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "llama-3.3-70b-versatile",
        max_tokens: 256,
        system: "Be terse.",
        messages: [USER_MESSAGE],
      },
    });

    expect(res.statusCode).toBe(200);
    // The upstream got an OpenAI-shaped request...
    const sent = upstream.chatCalls[0]!;
    expect(sent.url).toContain("/chat/completions");
    expect(sent.body).toMatchObject({
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hello" },
      ],
      max_tokens: 256,
    });

    // ...and the client got an Anthropic-shaped response.
    const body = res.json();
    expect(body).toMatchObject({
      type: "message",
      role: "assistant",
      model: "llama-3.3-70b-versatile",
      content: [{ type: "text", text: "from groq" }],
      stop_reason: "end_turn",
    });
    expect(body.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("passes an Anthropic request through to an Anthropic provider", async () => {
    const { build, upstream } = makeGateway();
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        messages: [USER_MESSAGE],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(upstream.chatCalls[0]!.url).toContain("/messages");
    expect(res.json().content[0].text).toBe("from anthropic");
  });

  it("streams Anthropic events from an OpenAI provider", async () => {
    const { build } = makeGateway({
      groq: () => sseResponse(openAIStreamFrames(["Hel", "lo"])),
    });
    const app = await start(build);

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "llama-3.3-70b-versatile",
        max_tokens: 64,
        messages: [USER_MESSAGE],
        stream: true,
      },
    });

    const events = parseSSEPayload(res.payload);
    expect(events.map((e) => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const text = events
      .filter((e) => e.event === "content_block_delta")
      .map((e) => JSON.parse(e.data).delta.text)
      .join("");
    expect(text).toBe("Hello");
  });

  it("asks OpenAI providers for usage so message_delta can report it", async () => {
    const { build, upstream } = makeGateway({
      groq: () => sseResponse(openAIStreamFrames(["hi"])),
    });
    const app = await start(build);

    await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        model: "llama-3.3-70b-versatile",
        max_tokens: 64,
        messages: [USER_MESSAGE],
        stream: true,
      },
    });

    expect(upstream.chatCalls[0]!.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("rejects a malformed request", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: { max_tokens: 10, messages: [USER_MESSAGE] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("missing_model");
  });
});

describe("authentication", () => {
  it("allows any caller when no keys are configured", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    const res = await app.inject({ method: "GET", url: "/v1/models" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an unauthenticated call when keys are configured", async () => {
    const { build } = makeGateway({}, { GATEWAY_API_KEYS: "secret-1,secret-2" });
    const app = await start(build);
    const res = await app.inject({ method: "GET", url: "/v1/models" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("invalid_api_key");
  });

  it("accepts a valid bearer token", async () => {
    const { build } = makeGateway({}, { GATEWAY_API_KEYS: "secret-1,secret-2" });
    const app = await start(build);
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer secret-2" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("accepts x-api-key too, for Anthropic SDK clients", async () => {
    const { build } = makeGateway({}, { GATEWAY_API_KEYS: "secret-1" });
    const app = await start(build);
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { "x-api-key": "secret-1" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a wrong key", async () => {
    const { build } = makeGateway({}, { GATEWAY_API_KEYS: "secret-1" });
    const app = await start(build);
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("leaves /health open for container probes", async () => {
    const { build } = makeGateway({}, { GATEWAY_API_KEYS: "secret-1" });
    const app = await start(build);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("never forwards the gateway key upstream", async () => {
    const { build, upstream } = makeGateway({}, { GATEWAY_API_KEYS: "secret-1" });
    const app = await start(build);
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret-1" },
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });
    expect(upstream.chatCalls[0]!.headers.authorization).toBe("Bearer groq-key");
  });
});

describe("discovery and admin endpoints", () => {
  it("aggregates models bare and namespaced, with aliases", async () => {
    const { build } = makeGateway();
    const app = await start(build);

    const res = await app.inject({ method: "GET", url: "/v1/models" });
    const ids = res.json().data.map((m: { id: string }) => m.id);

    expect(ids).toContain("auto");
    expect(ids).toContain("auto:free");
    expect(ids).toContain("gpt-5");
    expect(ids).toContain("openai/gpt-5");
    expect(ids).toContain("groq/llama-3.1-8b-instant");

    // A model two providers serve is listed once, naming both.
    const shared = res
      .json()
      .data.find((m: { id: string }) => m.id === "llama-3.3-70b-versatile");
    expect(shared.providers).toEqual(["groq", "openai"]);
  });

  it("explains which providers were skipped and why", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    const res = await app.inject({ method: "GET", url: "/admin/providers" });
    const body = res.json();
    expect(body.active.map((p: { id: string }) => p.id)).toEqual([
      "groq",
      "anthropic",
      "openai",
    ]);
    expect(body.skipped).toContainEqual({
      id: "deepseek",
      reason: "DEEPSEEK_API_KEY is not set",
    });
  });

  it("counts requests and tokens per provider", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });

    const stats = (await app.inject({ method: "GET", url: "/admin/stats" })).json();
    expect(stats.totals.successes).toBe(1);
    expect(stats.providers.groq.promptTokens).toBe(10);
    expect(stats.providers.groq.completionTokens).toBe(5);
  });

  it("counts a fallback against the provider that failed", async () => {
    const { build } = makeGateway({
      groq: () => jsonResponse({ error: { message: "down" } }, 500),
    });
    const app = await start(build);
    await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
    });

    const stats = (await app.inject({ method: "GET", url: "/admin/stats" })).json();
    expect(stats.providers.groq.failures).toBe(1);
    expect(stats.providers.groq.fallbacks).toBe(1);
    expect(stats.providers.openai.successes).toBe(1);
  });

  it("clears tripped breakers on request", async () => {
    const { build } = makeGateway({
      groq: () => jsonResponse({ error: { message: "down" } }, 500),
    });
    const app = await start(build);
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        payload: { model: "llama-3.3-70b-versatile", messages: [USER_MESSAGE] },
      });
    }
    let providers = (await app.inject({ method: "GET", url: "/admin/providers" })).json();
    expect(providers.active.find((p: { id: string }) => p.id === "groq").healthy).toBe(
      false,
    );

    await app.inject({ method: "POST", url: "/admin/breakers/reset" });
    providers = (await app.inject({ method: "GET", url: "/admin/providers" })).json();
    expect(providers.active.find((p: { id: string }) => p.id === "groq").healthy).toBe(
      true,
    );
  });

  it("describes itself at the root and 404s unknown paths helpfully", async () => {
    const { build } = makeGateway();
    const app = await start(build);
    expect((await app.inject({ method: "GET", url: "/" })).json().name).toBe(
      "omniroute-gateway",
    );
    const missing = await app.inject({ method: "GET", url: "/v1/embeddings" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("unknown_endpoint");
  });
});
