/**
 * Shared configuration and provider types.
 *
 * A "provider" is an upstream inference API. Most speak the OpenAI
 * chat-completions wire format; a few (Anthropic) speak their own. The gateway
 * normalises everything to the OpenAI shape internally — see src/translate.
 */

export type WireFormat = "openai" | "anthropic";

/** How a provider expects its credential to be presented. */
export type AuthStyle =
  /** `Authorization: Bearer <key>` — the default for OpenAI-compatible APIs. */
  | "bearer"
  /** `x-api-key: <key>` plus an anthropic-version header. */
  | "anthropic"
  /** `api-key: <key>` — Azure-style. */
  | "api-key"
  /** No credential at all — local runtimes such as Ollama or llama.cpp. */
  | "none";

/** A provider definition, either built in or supplied through config. */
export interface ProviderDef {
  /** Stable identifier, also the `provider/model` routing prefix. */
  id: string;
  /** Base URL including the version segment, no trailing slash. */
  baseUrl: string;
  /**
   * The next three are optional so a config-file entry can be two lines.
   * Registration fills them in: label defaults to the id, wire to "openai",
   * and auth to "bearer" when an apiKeyEnv is given, "none" otherwise.
   */
  label?: string;
  wire?: WireFormat;
  auth?: AuthStyle;
  /** Environment variable holding the credential, when auth !== "none". */
  apiKeyEnv?: string;
  /**
   * Environment variable that overrides `baseUrl`. Useful for self-hosted
   * deployments and for pointing a local runtime somewhere else.
   */
  baseUrlEnv?: string;
  /**
   * Environment variable that gates registration for keyless providers.
   * Set it to a truthy value to register the provider.
   */
  enableEnv?: string;
  /** True when the provider offers a usable free tier or free models. */
  free?: boolean;
  /** Provider is reachable only on the local machine. */
  local?: boolean;
  /**
   * Lower sorts first when several providers can serve the same model.
   * Built-ins use 100 for free tiers, 200 for paid, 50 for local.
   */
  priority?: number;
  /** Extra headers sent with every upstream request. */
  headers?: Record<string, string>;
  /** Provider does not implement `GET /models`; skip discovery for it. */
  noModelDiscovery?: boolean;
  /**
   * Models the provider is known to serve, used for routing before (or
   * instead of) live discovery. Discovery, when it succeeds, supersedes this.
   */
  models?: string[];
}

/** A provider that passed registration: credential resolved, URL resolved. */
export interface ResolvedProvider extends ProviderDef {
  baseUrl: string;
  label: string;
  wire: WireFormat;
  auth: AuthStyle;
  apiKey: string | null;
}

/** A named route: one model name in, an ordered list of candidates out. */
export interface RouteDef {
  /** The model name clients ask for, e.g. "auto" or "gpt-4o-mini". */
  model: string;
  /**
   * Ordered `provider/model` targets. The first healthy one wins; the rest are
   * fallbacks. A bare model name means "any provider that serves it".
   */
  targets: string[];
  /** Optional human description, surfaced in `/v1/models`. */
  description?: string;
}

export interface RetryPolicy {
  /** Maximum providers tried for one request, including the first. */
  maxAttempts: number;
  /** Per-attempt upstream timeout. */
  requestTimeoutMs: number;
  /** How long a stream may stall before the first token arrives. */
  streamFirstTokenTimeoutMs: number;
  /** Consecutive failures before a provider is taken out of rotation. */
  breakerThreshold: number;
  /** Base cooldown for an open breaker; doubles per additional trip. */
  breakerCooldownMs: number;
  /** Ceiling for the cooldown backoff. */
  breakerMaxCooldownMs: number;
}

export interface RoutingPolicy {
  /**
   * Preference order applied when several providers serve the same model.
   * "free" puts free tiers first, "priority" uses the provider priority
   * number only, "local" puts local runtimes first.
   */
  prefer: "free" | "priority" | "local";
  /**
   * Whether an explicit `provider/model` request may fall back to other
   * providers. Off by default: an explicit pin is a deliberate choice.
   */
  fallbackForPinnedModels: boolean;
}

export interface GatewayConfig {
  host: string;
  port: number;
  logLevel: string;
  /** Client credentials. Empty means unauthenticated access. */
  apiKeys: string[];
  retry: RetryPolicy;
  routing: RoutingPolicy;
  /** Providers added or overridden through the JSON config file. */
  customProviders: ProviderDef[];
  /** Named routes and virtual models. */
  routes: RouteDef[];
  /** Providers explicitly disabled by id, even if their key is present. */
  disabledProviders: string[];
  /** How long discovered model lists stay cached. */
  modelCacheTtlMs: number;
}

/** The JSON config file shape — every field optional, layered over env. */
export interface GatewayConfigFile {
  providers?: ProviderDef[];
  routes?: RouteDef[];
  routing?: Partial<RoutingPolicy>;
  retry?: Partial<RetryPolicy>;
  disabledProviders?: string[];
  apiKeys?: string[];
}
