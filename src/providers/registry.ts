import type { Env } from "../config/load.js";
import { parseBool } from "../config/load.js";
import type {
  GatewayConfig,
  ProviderDef,
  ResolvedProvider,
} from "../config/types.js";
import { BUILTIN_PROVIDERS } from "./catalog.js";

export interface RegistryResult {
  /** Providers that are configured and ready to receive traffic. */
  providers: ResolvedProvider[];
  /** Providers that exist in the catalog but were not registered, and why. */
  skipped: Array<{ id: string; reason: string }>;
}

/** A provider definition with every optional transport field filled in. */
type CompleteDef = ProviderDef &
  Required<Pick<ProviderDef, "label" | "wire" | "auth" | "priority">>;

function withDefaults(def: ProviderDef): CompleteDef {
  return {
    ...def,
    label: def.label ?? def.id,
    wire: def.wire ?? "openai",
    auth: def.auth ?? (def.apiKeyEnv ? "bearer" : "none"),
    priority: def.priority ?? 150,
  };
}

function mergeDefs(
  builtins: ProviderDef[],
  custom: ProviderDef[],
): CompleteDef[] {
  const byId = new Map<string, ProviderDef>();
  for (const def of builtins) byId.set(def.id, def);
  for (const def of custom) {
    const existing = byId.get(def.id);
    // A custom entry with a known id patches the built-in rather than
    // replacing it, so overriding just the base URL stays a one-line change.
    byId.set(def.id, existing ? { ...existing, ...def } : def);
  }
  return [...byId.values()].map(withDefaults);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Work out which providers are usable in this environment.
 *
 * A provider is registered when its credential is present (or it needs none
 * and is explicitly enabled) and it has not been disabled. Everything else is
 * reported in `skipped` so `/admin/providers` can explain the gaps.
 */
export function buildRegistry(
  config: GatewayConfig,
  env: Env = process.env,
): RegistryResult {
  const defs = mergeDefs(BUILTIN_PROVIDERS, config.customProviders);
  const disabled = new Set(config.disabledProviders);
  const providers: ResolvedProvider[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const def of defs) {
    if (disabled.has(def.id)) {
      skipped.push({ id: def.id, reason: "disabled by configuration" });
      continue;
    }

    const baseUrl = stripTrailingSlash(
      (def.baseUrlEnv ? env[def.baseUrlEnv]?.trim() : undefined) || def.baseUrl,
    );

    if (def.auth === "none") {
      // Keyless providers are opt-in: we do not want to route production
      // traffic at a localhost port that happens to be open.
      const gate = def.enableEnv;
      const enabled = gate
        ? parseBool(env[gate], false)
        : Boolean(def.baseUrl);
      if (!enabled) {
        skipped.push({
          id: def.id,
          reason: gate ? `${gate} is not set` : "not enabled",
        });
        continue;
      }
      providers.push({ ...def, baseUrl, apiKey: null });
      continue;
    }

    const apiKey = def.apiKeyEnv ? env[def.apiKeyEnv]?.trim() : undefined;
    if (!apiKey) {
      skipped.push({
        id: def.id,
        reason: def.apiKeyEnv ? `${def.apiKeyEnv} is not set` : "no credential",
      });
      continue;
    }
    providers.push({ ...def, baseUrl, apiKey });
  }

  providers.sort(
    (a, b) =>
      (a.priority ?? 1000) - (b.priority ?? 1000) || a.id.localeCompare(b.id),
  );
  return { providers, skipped };
}

/** Headers for an upstream call, including the provider credential. */
export function providerHeaders(p: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    ...p.headers,
  };
  switch (p.auth) {
    case "bearer":
      if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
      break;
    case "anthropic":
      if (p.apiKey) headers["x-api-key"] = p.apiKey;
      headers["anthropic-version"] ??= "2023-06-01";
      break;
    case "api-key":
      if (p.apiKey) headers["api-key"] = p.apiKey;
      break;
    case "none":
      break;
  }
  return headers;
}
