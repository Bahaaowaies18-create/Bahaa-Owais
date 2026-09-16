/** In-memory counters surfaced by `GET /admin/stats`. */

export interface ProviderStats {
  requests: number;
  successes: number;
  failures: number;
  fallbacks: number;
  promptTokens: number;
  completionTokens: number;
  totalLatencyMs: number;
}

function emptyStats(): ProviderStats {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    fallbacks: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalLatencyMs: 0,
  };
}

export class Stats {
  readonly startedAt = Date.now();
  private totals = emptyStats();
  private readonly byProvider = new Map<string, ProviderStats>();
  private readonly byModel = new Map<string, number>();

  private provider(id: string): ProviderStats {
    let entry = this.byProvider.get(id);
    if (!entry) {
      entry = emptyStats();
      this.byProvider.set(id, entry);
    }
    return entry;
  }

  recordAttempt(providerId: string): void {
    this.totals.requests += 1;
    this.provider(providerId).requests += 1;
  }

  recordSuccess(
    providerId: string,
    model: string,
    latencyMs: number,
    usage?: { prompt_tokens?: number; completion_tokens?: number },
  ): void {
    const entry = this.provider(providerId);
    entry.successes += 1;
    entry.totalLatencyMs += latencyMs;
    entry.promptTokens += usage?.prompt_tokens ?? 0;
    entry.completionTokens += usage?.completion_tokens ?? 0;
    this.totals.successes += 1;
    this.totals.totalLatencyMs += latencyMs;
    this.totals.promptTokens += usage?.prompt_tokens ?? 0;
    this.totals.completionTokens += usage?.completion_tokens ?? 0;
    this.byModel.set(model, (this.byModel.get(model) ?? 0) + 1);
  }

  recordFailure(providerId: string): void {
    this.provider(providerId).failures += 1;
    this.totals.failures += 1;
  }

  recordFallback(providerId: string): void {
    this.provider(providerId).fallbacks += 1;
    this.totals.fallbacks += 1;
  }

  snapshot(): {
    uptimeMs: number;
    totals: ProviderStats & { avgLatencyMs: number };
    providers: Record<string, ProviderStats & { avgLatencyMs: number }>;
    models: Record<string, number>;
  } {
    const withAvg = (s: ProviderStats) => ({
      ...s,
      avgLatencyMs: s.successes > 0 ? Math.round(s.totalLatencyMs / s.successes) : 0,
    });
    return {
      uptimeMs: Date.now() - this.startedAt,
      totals: withAvg(this.totals),
      providers: Object.fromEntries(
        [...this.byProvider.entries()].map(([id, s]) => [id, withAvg(s)]),
      ),
      models: Object.fromEntries(this.byModel),
    };
  }

  reset(): void {
    this.totals = emptyStats();
    this.byProvider.clear();
    this.byModel.clear();
  }
}
