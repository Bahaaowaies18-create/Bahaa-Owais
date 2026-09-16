import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import type { GatewayConfig } from "../src/config/types.js";
import { buildRegistry } from "../src/providers/registry.js";
import { CircuitBreaker } from "../src/routing/breaker.js";
import { ModelIndex } from "../src/routing/modelIndex.js";
import { Router } from "../src/routing/router.js";
import { GatewayError } from "../src/upstream/errors.js";
import { createMockUpstream, modelsResponse } from "./helpers/mockUpstream.js";

const PROVIDER_MODELS: Record<string, string[]> = {
  "api.groq.com": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  "api.openai.com": ["gpt-5", "gpt-5-mini", "llama-3.3-70b-versatile"],
  "api.anthropic.com": ["claude-sonnet-4-5", "claude-haiku-4-5"],
  "api.cerebras.ai": ["llama-3.3-70b"],
};

function makeRouter(
  env: Record<string, string | undefined>,
  overrides: Partial<GatewayConfig> = {},
) {
  const upstream = createMockUpstream(
    Object.fromEntries(
      Object.entries(PROVIDER_MODELS).map(([host, models]) => [
        host,
        () => modelsResponse(models),
      ]),
    ),
  );
  const config = { ...loadConfig(env), ...overrides };
  const { providers } = buildRegistry(config, env);
  const breaker = new CircuitBreaker(config.retry);
  const modelIndex = new ModelIndex(60_000, upstream.fetchImpl);
  return {
    router: new Router(config, providers, modelIndex, breaker),
    breaker,
    modelIndex,
    providers,
  };
}

const ALL_KEYS = {
  GROQ_API_KEY: "g",
  OPENAI_API_KEY: "o",
  ANTHROPIC_API_KEY: "a",
  CEREBRAS_API_KEY: "c",
};

describe("Router.resolve", () => {
  it("fails clearly when nothing is configured", async () => {
    const { router } = makeRouter({});
    await expect(router.resolve("gpt-5")).rejects.toMatchObject({
      status: 503,
      code: "no_providers",
    });
  });

  it("pins provider/model requests to that provider", async () => {
    const { router } = makeRouter(ALL_KEYS);
    const result = await router.resolve("groq/llama-3.1-8b-instant");
    expect(result.via).toBe("pinned");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      model: "llama-3.1-8b-instant",
    });
    expect(result.candidates[0]!.provider.id).toBe("groq");
  });

  it("keeps slashes in model names that are not provider prefixes", async () => {
    const { router } = makeRouter({
      ...ALL_KEYS,
      TOGETHER_API_KEY: "t",
    });
    // "meta-llama" is not a registered provider, so the whole string is a model.
    const result = await router.resolve("meta-llama/Llama-3.3-70B-Instruct");
    expect(result.candidates[0]!.model).toBe("meta-llama/Llama-3.3-70B-Instruct");
  });

  it("does not add fallbacks to a pin by default", async () => {
    const { router } = makeRouter(ALL_KEYS);
    const result = await router.resolve("openai/llama-3.3-70b-versatile");
    expect(result.candidates.map((c) => c.provider.id)).toEqual(["openai"]);
  });

  it("adds fallbacks to a pin when the policy allows it", async () => {
    const { router } = makeRouter(ALL_KEYS, {
      routing: { prefer: "free", fallbackForPinnedModels: true },
    });
    const result = await router.resolve("openai/llama-3.3-70b-versatile");
    expect(result.candidates.map((c) => c.provider.id)).toEqual([
      "openai",
      "groq",
    ]);
  });

  it("fans a bare model name out across every provider that serves it", async () => {
    const { router } = makeRouter(ALL_KEYS);
    const result = await router.resolve("llama-3.3-70b-versatile");
    expect(result.via).toBe("discovered");
    // "free" preference puts Groq's free tier ahead of paid OpenAI.
    expect(result.candidates.map((c) => c.provider.id)).toEqual([
      "groq",
      "openai",
    ]);
  });

  it("honours the priority preference order", async () => {
    const { router } = makeRouter(ALL_KEYS, {
      routing: { prefer: "priority", fallbackForPinnedModels: false },
    });
    const result = await router.resolve("llama-3.3-70b-versatile");
    expect(result.candidates.map((c) => c.provider.id)).toEqual([
      "groq",
      "openai",
    ]);
  });

  it("resolves the auto alias to a capable model", async () => {
    const { router } = makeRouter(ALL_KEYS);
    const result = await router.resolve("auto");
    expect(result.via).toBe("alias");
    // gpt-5 is the first pattern; gpt-5-mini must not match it.
    expect(result.candidates[0]).toMatchObject({ model: "gpt-5" });
    expect(result.candidates.map((c) => c.model)).not.toContain("gpt-5-mini");
  });

  it("resolves auto:fast to the small models", async () => {
    const { router } = makeRouter(ALL_KEYS);
    const result = await router.resolve("auto:fast");
    const models = result.candidates.map((c) => c.model);
    expect(models).toContain("gpt-5-mini");
    expect(models).toContain("claude-haiku-4-5");
    expect(models).not.toContain("gpt-5");
  });

  it("restricts auto:free to free-tier providers", async () => {
    const { router } = makeRouter(ALL_KEYS);
    const result = await router.resolve("auto:free");
    const ids = new Set(result.candidates.map((c) => c.provider.id));
    expect(ids.has("groq")).toBe(true);
    expect(ids.has("cerebras")).toBe(true);
    expect(ids.has("openai")).toBe(false);
    expect(ids.has("anthropic")).toBe(false);
  });

  it("reports when an alias matches nothing", async () => {
    const { router } = makeRouter({ CEREBRAS_API_KEY: "c" });
    await expect(router.resolve("auto:local")).rejects.toMatchObject({
      status: 503,
      code: "alias_unmatched",
    });
  });

  it("expands a configured route in order", async () => {
    const { router } = makeRouter(ALL_KEYS, {
      routes: [
        {
          model: "cheap",
          targets: ["groq/llama-3.1-8b-instant", "openai/gpt-5-mini"],
        },
      ],
    });
    const result = await router.resolve("cheap");
    expect(result.via).toBe("route");
    expect(result.candidates).toEqual([
      expect.objectContaining({ model: "llama-3.1-8b-instant" }),
      expect.objectContaining({ model: "gpt-5-mini" }),
    ]);
  });

  it("expands provider/* to the originally requested model", async () => {
    const { router } = makeRouter(ALL_KEYS, {
      routes: [{ model: "gpt-5", targets: ["openai/*", "groq/*"] }],
    });
    const result = await router.resolve("gpt-5");
    expect(result.candidates.map((c) => c.model)).toEqual(["gpt-5", "gpt-5"]);
    expect(result.candidates.map((c) => c.provider.id)).toEqual([
      "openai",
      "groq",
    ]);
  });

  it("puts providers with a tripped breaker last, without dropping them", async () => {
    const { router, breaker } = makeRouter(ALL_KEYS);
    for (let i = 0; i < 3; i++) breaker.recordFailure("groq");
    const result = await router.resolve("llama-3.3-70b-versatile");
    expect(result.candidates.map((c) => c.provider.id)).toEqual([
      "openai",
      "groq",
    ]);
  });

  it("404s an unknown model with suggestions", async () => {
    const { router, modelIndex, providers } = makeRouter(ALL_KEYS);
    await modelIndex.refreshAll(providers);
    const err = await router.resolve("gpt-5-turbo-max").catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.status).toBe(404);
    expect(err.message).toContain("openai/gpt-5");
  });

  it("passes unknown models through to providers with no catalogue", async () => {
    // A local runtime that reports no models should still be tried.
    const upstream = createMockUpstream({
      localhost: () => modelsResponse([]),
    });
    const env = { OLLAMA_ENABLED: "true" };
    const config = loadConfig(env);
    const { providers } = buildRegistry(config, env);
    const router = new Router(
      config,
      providers,
      new ModelIndex(60_000, upstream.fetchImpl),
      new CircuitBreaker(config.retry),
    );
    const result = await router.resolve("qwen3:4b");
    expect(result.via).toBe("passthrough");
    expect(result.candidates[0]!.provider.id).toBe("ollama");
    expect(result.candidates[0]!.model).toBe("qwen3:4b");
  });
});

describe("provider registry", () => {
  it("registers only providers whose credentials are present", () => {
    const config = loadConfig({ GROQ_API_KEY: "g" });
    const { providers, skipped } = buildRegistry(config, { GROQ_API_KEY: "g" });
    expect(providers.map((p) => p.id)).toEqual(["groq"]);
    expect(skipped.find((s) => s.id === "openai")?.reason).toBe(
      "OPENAI_API_KEY is not set",
    );
  });

  it("requires keyless providers to be enabled explicitly", () => {
    const env = { OLLAMA_ENABLED: "false" };
    const { providers, skipped } = buildRegistry(loadConfig(env), env);
    expect(providers).toHaveLength(0);
    expect(skipped.find((s) => s.id === "ollama")?.reason).toBe(
      "OLLAMA_ENABLED is not set",
    );
  });

  it("lets env vars override a built-in base URL", () => {
    const env = { GROQ_API_KEY: "g", GROQ_BASE_URL: "http://localhost:9999/v1/" };
    const { providers } = buildRegistry(loadConfig(env), env);
    expect(providers[0]!.baseUrl).toBe("http://localhost:9999/v1");
  });

  it("honours DISABLED_PROVIDERS", () => {
    const env = { GROQ_API_KEY: "g", OPENAI_API_KEY: "o", DISABLED_PROVIDERS: "groq" };
    const { providers } = buildRegistry(loadConfig(env), env);
    expect(providers.map((p) => p.id)).toEqual(["openai"]);
  });

  it("fills defaults in for a minimal custom provider", () => {
    const env = { MY_KEY: "k" };
    const config = {
      ...loadConfig(env),
      customProviders: [
        { id: "mine", baseUrl: "https://mine.example/v1", apiKeyEnv: "MY_KEY" },
      ],
    };
    const { providers } = buildRegistry(config, env);
    const mine = providers.find((p) => p.id === "mine")!;
    expect(mine).toMatchObject({
      label: "mine",
      wire: "openai",
      auth: "bearer",
      priority: 150,
      apiKey: "k",
    });
  });

  it("patches a built-in provider rather than replacing it", () => {
    const env = { ANTHROPIC_API_KEY: "a" };
    const config = {
      ...loadConfig(env),
      customProviders: [
        { id: "anthropic", baseUrl: "https://proxy.example/v1" },
      ],
    };
    const { providers } = buildRegistry(config, env);
    const anthropic = providers.find((p) => p.id === "anthropic")!;
    expect(anthropic.baseUrl).toBe("https://proxy.example/v1");
    // The wire format and auth style survive the override.
    expect(anthropic.wire).toBe("anthropic");
    expect(anthropic.auth).toBe("anthropic");
  });
});
