import type { FastifyInstance } from "fastify";
import type { GatewayContext } from "../server.js";
import type { OpenAIModel } from "../translate/openai-types.js";
import { BUILTIN_ALIASES } from "../routing/router.js";
import { nowSeconds } from "../util/ids.js";

interface GatewayModel extends OpenAIModel {
  /** Providers that can serve this model, in routing order. */
  providers: string[];
}

/**
 * Aggregated model listing.
 *
 * Every model is listed twice: once bare (routable across all providers that
 * serve it, with fallback) and once namespaced as `provider/model` (pinned).
 * Virtual aliases and configured routes are listed first so `auto` is
 * discoverable from any OpenAI-compatible client's model picker.
 */
export async function registerModelRoutes(
  app: FastifyInstance,
  ctx: GatewayContext,
): Promise<void> {
  app.get("/v1/models", async () => {
    await ctx.modelIndex.refreshAll(ctx.providers);
    const created = nowSeconds();
    const byModel = new Map<string, GatewayModel>();
    const rows: GatewayModel[] = [];

    for (const [alias, def] of Object.entries(BUILTIN_ALIASES)) {
      rows.push({
        id: alias,
        object: "model",
        created,
        owned_by: "omniroute",
        description: def.description,
        providers: [],
      } as GatewayModel);
    }
    for (const route of ctx.config.routes) {
      rows.push({
        id: route.model,
        object: "model",
        created,
        owned_by: "omniroute",
        description: route.description ?? `Route → ${route.targets.join(" → ")}`,
        providers: route.targets,
      } as GatewayModel);
    }

    for (const provider of ctx.providers) {
      for (const model of ctx.modelIndex.cached(provider.id)) {
        rows.push({
          id: `${provider.id}/${model}`,
          object: "model",
          created,
          owned_by: provider.id,
          providers: [provider.id],
        });
        const existing = byModel.get(model);
        if (existing) {
          existing.providers.push(provider.id);
        } else {
          const entry: GatewayModel = {
            id: model,
            object: "model",
            created,
            owned_by: provider.id,
            providers: [provider.id],
          };
          byModel.set(model, entry);
          rows.push(entry);
        }
      }
    }

    return { object: "list", data: rows };
  });

  // Anthropic SDKs probe this path; serve the same list in their shape.
  app.get("/v1/models/:id", async (request) => {
    const { id } = request.params as { id: string };
    return {
      id,
      object: "model",
      created: nowSeconds(),
      owned_by: "omniroute",
    };
  });
}
