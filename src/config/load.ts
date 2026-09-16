import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type {
  GatewayConfig,
  GatewayConfigFile,
  ProviderDef,
  RetryPolicy,
  RoutingPolicy,
} from "./types.js";

export type Env = Record<string, string | undefined>;

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  requestTimeoutMs: 120_000,
  streamFirstTokenTimeoutMs: 30_000,
  breakerThreshold: 3,
  breakerCooldownMs: 15_000,
  breakerMaxCooldownMs: 5 * 60_000,
};

const DEFAULT_ROUTING: RoutingPolicy = {
  prefer: "free",
  fallbackForPinnedModels: false,
};

export function parseBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Read and validate the optional JSON config file. */
export function readConfigFile(path: string): GatewayConfigFile {
  let raw: string;
  try {
    raw = readFileSync(resolvePath(path), "utf8");
  } catch (err) {
    throw new Error(
      `GATEWAY_CONFIG points at ${path}, which could not be read: ${
        (err as Error).message
      }`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object at the top level.`);
  }
  const file = parsed as GatewayConfigFile;
  for (const p of file.providers ?? []) {
    if (!p.id || !p.baseUrl) {
      throw new Error(
        `${path}: every entry in "providers" needs at least "id" and "baseUrl".`,
      );
    }
    if (p.wire && p.wire !== "openai" && p.wire !== "anthropic") {
      throw new Error(
        `${path}: provider "${p.id}" has unknown wire format "${p.wire}".`,
      );
    }
  }
  for (const r of file.routes ?? []) {
    if (!r.model || !Array.isArray(r.targets) || r.targets.length === 0) {
      throw new Error(
        `${path}: every entry in "routes" needs a "model" and a non-empty "targets" array.`,
      );
    }
  }
  return file;
}

/**
 * Build the effective configuration. Precedence, lowest to highest:
 * built-in defaults → JSON config file → environment variables.
 */
export function loadConfig(env: Env = process.env): GatewayConfig {
  const file: GatewayConfigFile = env.GATEWAY_CONFIG
    ? readConfigFile(env.GATEWAY_CONFIG)
    : {};

  const retry: RetryPolicy = {
    ...DEFAULT_RETRY,
    ...file.retry,
    maxAttempts: parseIntOr(
      env.MAX_ATTEMPTS,
      file.retry?.maxAttempts ?? DEFAULT_RETRY.maxAttempts,
    ),
    requestTimeoutMs: parseIntOr(
      env.REQUEST_TIMEOUT_MS,
      file.retry?.requestTimeoutMs ?? DEFAULT_RETRY.requestTimeoutMs,
    ),
    streamFirstTokenTimeoutMs: parseIntOr(
      env.STREAM_FIRST_TOKEN_TIMEOUT_MS,
      file.retry?.streamFirstTokenTimeoutMs ??
        DEFAULT_RETRY.streamFirstTokenTimeoutMs,
    ),
  };

  const preferEnv = env.ROUTING_PREFER?.trim().toLowerCase();
  const prefer: RoutingPolicy["prefer"] =
    preferEnv === "free" || preferEnv === "priority" || preferEnv === "local"
      ? preferEnv
      : (file.routing?.prefer ?? DEFAULT_ROUTING.prefer);

  const routing: RoutingPolicy = {
    prefer,
    fallbackForPinnedModels: parseBool(
      env.FALLBACK_FOR_PINNED_MODELS,
      file.routing?.fallbackForPinnedModels ??
        DEFAULT_ROUTING.fallbackForPinnedModels,
    ),
  };

  const apiKeys = [
    ...parseList(env.GATEWAY_API_KEYS),
    ...(file.apiKeys ?? []),
  ];

  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: parseIntOr(env.PORT, 8787),
    logLevel: env.LOG_LEVEL?.trim() || "info",
    apiKeys: [...new Set(apiKeys)],
    retry,
    routing,
    customProviders: (file.providers ?? []) as ProviderDef[],
    routes: file.routes ?? [],
    disabledProviders: [
      ...parseList(env.DISABLED_PROVIDERS),
      ...(file.disabledProviders ?? []),
    ],
    modelCacheTtlMs: parseIntOr(env.MODEL_CACHE_TTL_MS, 10 * 60_000),
  };
}
