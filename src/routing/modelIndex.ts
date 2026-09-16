import type { ResolvedProvider } from "../config/types.js";
import { providerHeaders } from "../providers/registry.js";

export interface ProviderModels {
  providerId: string;
  models: string[];
  /** When the list was last refreshed, or null if never fetched. */
  fetchedAt: number | null;
  /** Why the last discovery attempt failed, if it did. */
  error: string | null;
  /** True when the list came from the catalog hint rather than the provider. */
  static: boolean;
}

interface Entry extends ProviderModels {
  inFlight: Promise<void> | null;
}

/**
 * Live model discovery with a TTL cache.
 *
 * Model catalogues change constantly, so the gateway asks each provider what
 * it serves rather than hardcoding lists. Discovery failures are non-fatal:
 * the provider keeps its catalog hint (if any) and stays routable for
 * explicit `provider/model` requests.
 */
export class ModelIndex {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  private entry(provider: ResolvedProvider): Entry {
    let entry = this.entries.get(provider.id);
    if (!entry) {
      entry = {
        providerId: provider.id,
        models: provider.models ? [...provider.models] : [],
        fetchedAt: null,
        error: null,
        static: Boolean(provider.models?.length),
        inFlight: null,
      };
      this.entries.set(provider.id, entry);
    }
    return entry;
  }

  private isFresh(entry: Entry): boolean {
    return entry.fetchedAt !== null && Date.now() - entry.fetchedAt < this.ttlMs;
  }

  /** Models known for one provider, refreshing the cache when stale. */
  async modelsFor(provider: ResolvedProvider): Promise<string[]> {
    const entry = this.entry(provider);
    if (provider.noModelDiscovery || this.isFresh(entry)) return entry.models;
    if (!entry.inFlight) {
      entry.inFlight = this.refresh(provider, entry).finally(() => {
        entry.inFlight = null;
      });
    }
    await entry.inFlight;
    return entry.models;
  }

  private async refresh(provider: ResolvedProvider, entry: Entry): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${provider.baseUrl}/models`, {
        method: "GET",
        headers: providerHeaders(provider),
        signal: controller.signal,
      });
      if (!res.ok) {
        entry.error = `HTTP ${res.status}`;
        // Keep whatever we had; a provider that hides /models is still usable.
        entry.fetchedAt = Date.now();
        return;
      }
      const body = (await res.json()) as {
        data?: Array<{ id?: string; name?: string }>;
        models?: Array<{ id?: string; name?: string }>;
      };
      const rows = body.data ?? body.models ?? [];
      const ids = rows
        .map((row) => row.id ?? row.name)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ids.length > 0) {
        entry.models = ids;
        entry.static = false;
      }
      entry.error = null;
      entry.fetchedAt = Date.now();
    } catch (err) {
      entry.error = (err as Error)?.message ?? String(err);
      entry.fetchedAt = Date.now();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Refresh every provider in parallel, ignoring individual failures. */
  async refreshAll(providers: ResolvedProvider[]): Promise<void> {
    await Promise.all(providers.map((p) => this.modelsFor(p).catch(() => [])));
  }

  /** Cached view without triggering any network calls. */
  snapshot(): ProviderModels[] {
    return [...this.entries.values()].map(({ inFlight: _inFlight, ...rest }) => ({
      ...rest,
      models: [...rest.models],
    }));
  }

  /** Cached models for a provider id, or an empty list. */
  cached(providerId: string): string[] {
    return this.entries.get(providerId)?.models ?? [];
  }
}
