import type {
  GatewayConfig,
  ResolvedProvider,
  RouteDef,
} from "../config/types.js";
import { GatewayError } from "../upstream/errors.js";
import type { CircuitBreaker } from "./breaker.js";
import type { ModelIndex } from "./modelIndex.js";

/** One upstream attempt: which provider, and under which model id. */
export interface Candidate {
  provider: ResolvedProvider;
  /** The model id to send upstream, which may differ from the client's. */
  model: string;
}

export interface ResolveResult {
  /** Ordered attempts; the first healthy one is tried first. */
  candidates: Candidate[];
  /** How the model name was interpreted, for logging and debugging. */
  via: "route" | "alias" | "pinned" | "discovered" | "passthrough";
}

/**
 * Built-in virtual models.
 *
 * Each alias is matched against the models providers actually report, so the
 * aliases keep working as provider catalogues change. Patterns are tried in
 * order, and the first pattern with any match decides the tier.
 */
interface AliasDef {
  description: string;
  patterns: RegExp[];
  filter?: (p: ResolvedProvider) => boolean;
}

export const BUILTIN_ALIASES: Record<string, AliasDef> = {
  auto: {
    description: "Best generally-capable model available on your providers",
    patterns: [
      /^(?!.*mini)(?!.*nano).*gpt-5/i,
      /claude.*(opus|sonnet)/i,
      /gemini-[\d.]+-pro/i,
      /deepseek-(chat|v3)/i,
      /llama.*(405b|70b)/i,
      /qwen.*(max|72b)/i,
      /mistral-large/i,
      /grok-[\d]/i,
    ],
  },
  "auto:fast": {
    description: "Smallest/fastest capable model available",
    patterns: [
      /gpt-(5|4o)-(mini|nano)/i,
      /claude.*haiku/i,
      /gemini.*flash/i,
      /llama.*(8b|instant)/i,
      /qwen.*(7b|turbo)/i,
      /mistral-small/i,
    ],
  },
  "auto:free": {
    description: "Any model on a provider with a free tier",
    patterns: [/:free$/i, /./],
    filter: (p) => Boolean(p.free),
  },
  "auto:local": {
    description: "Any model on a locally hosted runtime",
    patterns: [/./],
    filter: (p) => Boolean(p.local),
  },
};

export class Router {
  private readonly routesByModel: Map<string, RouteDef>;

  constructor(
    private readonly config: GatewayConfig,
    private readonly providers: ResolvedProvider[],
    private readonly modelIndex: ModelIndex,
    private readonly breaker: CircuitBreaker,
  ) {
    this.routesByModel = new Map(config.routes.map((r) => [r.model, r]));
  }

  get allProviders(): ResolvedProvider[] {
    return this.providers;
  }

  private byId(id: string): ResolvedProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  /** Apply the configured preference order to a provider list. */
  private sortProviders(list: ResolvedProvider[]): ResolvedProvider[] {
    const prefer = this.config.routing.prefer;
    return [...list].sort((a, b) => {
      if (prefer === "free") {
        const rank = Number(Boolean(b.free)) - Number(Boolean(a.free));
        if (rank !== 0) return rank;
      } else if (prefer === "local") {
        const rank = Number(Boolean(b.local)) - Number(Boolean(a.local));
        if (rank !== 0) return rank;
      }
      return (
        (a.priority ?? 1000) - (b.priority ?? 1000) || a.id.localeCompare(b.id)
      );
    });
  }

  /**
   * Put healthy providers ahead of ones whose breaker is open, without
   * dropping the open ones: a degraded provider still beats no answer.
   */
  private prioritiseHealthy(candidates: Candidate[]): Candidate[] {
    const healthy: Candidate[] = [];
    const degraded: Candidate[] = [];
    for (const candidate of candidates) {
      if (this.breaker.isOpen(candidate.provider.id)) degraded.push(candidate);
      else healthy.push(candidate);
    }
    return [...healthy, ...degraded];
  }

  /** Split "provider/model"; returns null when the prefix is not a provider. */
  private splitPinned(
    name: string,
  ): { provider: ResolvedProvider; model: string } | null {
    const slash = name.indexOf("/");
    if (slash <= 0) return null;
    const provider = this.byId(name.slice(0, slash));
    if (!provider) return null;
    const model = name.slice(slash + 1);
    return model ? { provider, model } : null;
  }

  /** Providers that report serving `model`, plus ones that report nothing. */
  private async providersServing(model: string): Promise<{
    known: ResolvedProvider[];
    unknown: ResolvedProvider[];
  }> {
    const known: ResolvedProvider[] = [];
    const unknown: ResolvedProvider[] = [];
    await Promise.all(
      this.providers.map(async (provider) => {
        let models: string[];
        try {
          models = await this.modelIndex.modelsFor(provider);
        } catch {
          models = this.modelIndex.cached(provider.id);
        }
        if (models.length === 0) unknown.push(provider);
        else if (models.includes(model)) known.push(provider);
      }),
    );
    return { known, unknown };
  }

  private async resolveAlias(alias: AliasDef): Promise<Candidate[]> {
    const pool = this.sortProviders(
      alias.filter ? this.providers.filter(alias.filter) : this.providers,
    );
    const candidates: Candidate[] = [];
    const seen = new Set<string>();

    // Walk patterns outermost so that every provider's best match at tier N is
    // preferred over any provider's match at tier N+1.
    for (const pattern of alias.patterns) {
      for (const provider of pool) {
        let models: string[];
        try {
          models = await this.modelIndex.modelsFor(provider);
        } catch {
          models = this.modelIndex.cached(provider.id);
        }
        const match = models.find((m) => pattern.test(m));
        if (!match) continue;
        const key = `${provider.id}/${match}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ provider, model: match });
      }
    }
    return candidates;
  }

  private async expandRoute(
    route: RouteDef,
    requestedModel: string,
  ): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const target of route.targets) {
      const pinned = this.splitPinned(target);
      if (pinned) {
        // "provider/*" means "that provider, keeping the requested model".
        const model = pinned.model === "*" ? requestedModel : pinned.model;
        candidates.push({ provider: pinned.provider, model });
        continue;
      }
      const { known, unknown } = await this.providersServing(target);
      for (const provider of this.sortProviders(known)) {
        candidates.push({ provider, model: target });
      }
      if (known.length === 0) {
        for (const provider of this.sortProviders(unknown)) {
          candidates.push({ provider, model: target });
        }
      }
    }
    return candidates;
  }

  private suggestions(model: string): string[] {
    const needle = model.toLowerCase();
    const hits: string[] = [];
    for (const provider of this.providers) {
      for (const candidate of this.modelIndex.cached(provider.id)) {
        const lower = candidate.toLowerCase();
        if (lower.includes(needle) || needle.includes(lower)) {
          hits.push(`${provider.id}/${candidate}`);
        }
        if (hits.length >= 8) return hits;
      }
    }
    return hits;
  }

  /**
   * Turn a requested model name into an ordered list of upstream attempts.
   *
   * Resolution order: configured route, built-in alias, `provider/model` pin,
   * then live model discovery.
   */
  async resolve(requestedModel: string): Promise<ResolveResult> {
    if (this.providers.length === 0) {
      throw new GatewayError(
        503,
        "No providers are configured. Set at least one provider API key (see .env.example) and restart.",
        { type: "api_error", code: "no_providers" },
      );
    }

    const route = this.routesByModel.get(requestedModel);
    if (route) {
      const candidates = await this.expandRoute(route, requestedModel);
      if (candidates.length > 0) {
        return { candidates: this.prioritiseHealthy(candidates), via: "route" };
      }
      throw new GatewayError(
        503,
        `Route "${requestedModel}" is configured but none of its targets (${route.targets.join(
          ", ",
        )}) map to a registered provider.`,
        { type: "api_error", code: "route_unavailable" },
      );
    }

    const alias = BUILTIN_ALIASES[requestedModel];
    if (alias) {
      const candidates = await this.resolveAlias(alias);
      if (candidates.length > 0) {
        return { candidates: this.prioritiseHealthy(candidates), via: "alias" };
      }
      throw new GatewayError(
        503,
        `No configured provider offers a model matching "${requestedModel}". Add a provider key, or define an explicit route for it.`,
        { type: "api_error", code: "alias_unmatched" },
      );
    }

    const pinned = this.splitPinned(requestedModel);
    if (pinned) {
      const candidates: Candidate[] = [
        { provider: pinned.provider, model: pinned.model },
      ];
      if (this.config.routing.fallbackForPinnedModels) {
        const { known } = await this.providersServing(pinned.model);
        for (const provider of this.sortProviders(known)) {
          if (provider.id !== pinned.provider.id) {
            candidates.push({ provider, model: pinned.model });
          }
        }
      }
      return { candidates: this.prioritiseHealthy(candidates), via: "pinned" };
    }

    const { known, unknown } = await this.providersServing(requestedModel);
    if (known.length > 0) {
      const candidates = this.sortProviders(known).map((provider) => ({
        provider,
        model: requestedModel,
      }));
      return { candidates: this.prioritiseHealthy(candidates), via: "discovered" };
    }

    // Nobody advertises the model, but providers that report no catalogue at
    // all (local runtimes, private deployments) may still serve it.
    if (unknown.length > 0) {
      const candidates = this.sortProviders(unknown).map((provider) => ({
        provider,
        model: requestedModel,
      }));
      return {
        candidates: this.prioritiseHealthy(candidates),
        via: "passthrough",
      };
    }

    const hints = this.suggestions(requestedModel);
    throw new GatewayError(
      404,
      `No configured provider serves model "${requestedModel}".${
        hints.length ? ` Did you mean: ${hints.join(", ")}?` : ""
      }`,
      { type: "invalid_request_error", code: "model_not_found", details: hints },
    );
  }
}
