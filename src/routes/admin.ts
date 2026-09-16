import type { FastifyInstance } from "fastify";
import type { GatewayContext } from "../server.js";

export async function registerAdminRoutes(
  app: FastifyInstance,
  ctx: GatewayContext,
): Promise<void> {
  /**
   * What is registered, what was skipped and why, and current breaker state.
   * This is the first thing to check when a model "cannot be found".
   */
  app.get("/admin/providers", async () => {
    const health = new Map(
      ctx.breaker.snapshot().map((h) => [h.providerId, h]),
    );
    return {
      active: ctx.providers.map((p) => {
        const h = health.get(p.id);
        return {
          id: p.id,
          label: p.label,
          baseUrl: p.baseUrl,
          wire: p.wire,
          free: Boolean(p.free),
          local: Boolean(p.local),
          priority: p.priority ?? 1000,
          knownModels: ctx.modelIndex.cached(p.id).length,
          healthy: !(h?.open ?? false),
          openUntil: h?.openUntil ?? null,
          lastError: h?.lastError ?? null,
        };
      }),
      skipped: ctx.skippedProviders,
      routing: ctx.config.routing,
      retry: ctx.config.retry,
    };
  });

  app.get("/admin/stats", async () => ctx.stats.snapshot());

  app.get("/admin/models", async () => ({
    providers: ctx.modelIndex.snapshot(),
  }));

  /** Force a model re-discovery, e.g. after adding a model to a local runtime. */
  app.post("/admin/refresh", async () => {
    await ctx.modelIndex.refreshAll(ctx.providers);
    return { refreshed: ctx.providers.length, at: new Date().toISOString() };
  });

  /** Clear tripped breakers so a recovered provider is used immediately. */
  app.post("/admin/breakers/reset", async () => {
    ctx.breaker.reset();
    return { ok: true };
  });
}
