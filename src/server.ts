import Fastify, { LogController, type FastifyInstance } from "fastify";
import { extractApiKey, isAuthorized } from "./auth/apiKeys.js";
import { loadConfig, type Env } from "./config/load.js";
import type { GatewayConfig, ResolvedProvider } from "./config/types.js";
import { Stats } from "./observability/stats.js";
import { buildRegistry } from "./providers/registry.js";
import { CircuitBreaker } from "./routing/breaker.js";
import { ModelIndex } from "./routing/modelIndex.js";
import { Router } from "./routing/router.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerMessagesRoutes } from "./routes/messages.js";
import { registerModelRoutes } from "./routes/models.js";
import { GatewayError } from "./upstream/errors.js";

/** Everything the route handlers need, assembled once at boot. */
export interface GatewayContext {
  config: GatewayConfig;
  providers: ResolvedProvider[];
  skippedProviders: Array<{ id: string; reason: string }>;
  router: Router;
  breaker: CircuitBreaker;
  modelIndex: ModelIndex;
  stats: Stats;
  fetchImpl: typeof fetch;
}

export interface BuildOptions {
  env?: Env;
  config?: GatewayConfig;
  /** Injected in tests to point every provider at a mock upstream. */
  fetchImpl?: typeof fetch;
}

export function buildContext(options: BuildOptions = {}): GatewayContext {
  const env = options.env ?? process.env;
  const config = options.config ?? loadConfig(env);
  const { providers, skipped } = buildRegistry(config, env);
  const breaker = new CircuitBreaker(config.retry);
  const fetchImpl = options.fetchImpl ?? fetch;
  const modelIndex = new ModelIndex(config.modelCacheTtlMs, fetchImpl);
  const router = new Router(config, providers, modelIndex, breaker);

  return {
    config,
    providers,
    skippedProviders: skipped,
    router,
    breaker,
    modelIndex,
    stats: new Stats(),
    fetchImpl,
  };
}

export async function buildServer(
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  const ctx = buildContext(options);

  // One access-log line per request is noise for a proxy that already logs
  // routing decisions, so keep it for debug only.
  const quiet = ctx.config.logLevel !== "debug";

  const app = Fastify({
    logger: { level: ctx.config.logLevel },
    // Model payloads with long conversations and base64 images get large.
    bodyLimit: 32 * 1024 * 1024,
    logController: new LogController({ disableRequestLogging: quiet }),
  });

  app.decorate("gateway", ctx);

  if (ctx.config.apiKeys.length === 0 && !isLoopback(ctx.config.host)) {
    app.log.warn(
      `GATEWAY_API_KEYS is empty and the gateway is bound to ${ctx.config.host}. ` +
        "Anyone who can reach this port can spend your provider credits. " +
        "Set GATEWAY_API_KEYS before exposing it.",
    );
  }

  // Authentication: everything under /v1 and /admin needs a key when any is
  // configured. /health stays open so container probes work.
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? "";
    if (url === "/health" || url === "/") return;
    const presented = extractApiKey(
      request.headers as Record<string, string | string[] | undefined>,
    );
    if (!isAuthorized(ctx.config.apiKeys, presented)) {
      await reply.status(401).send({
        error: {
          message:
            "Missing or invalid credentials. Send your gateway key as `Authorization: Bearer <key>`.",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      });
    }
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof GatewayError) {
      request.log.warn({ err: err.message, code: err.code }, "gateway error");
      return reply.status(err.status).send({
        error: {
          message: err.message,
          type: err.type,
          code: err.code ?? null,
          details: err.details ?? undefined,
        },
      });
    }
    const fastifyErr = err as { statusCode?: number; code?: string; message?: string };
    const status =
      typeof fastifyErr.statusCode === "number" ? fastifyErr.statusCode : 500;
    request.log.error({ err }, "unhandled error");
    return reply.status(status).send({
      error: {
        message: fastifyErr.message || "Internal gateway error",
        type: status >= 500 ? "api_error" : "invalid_request_error",
        code: fastifyErr.code ?? null,
      },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        message: `Unknown endpoint ${request.method} ${request.url}. This gateway serves /v1/chat/completions, /v1/messages, /v1/models, /health and /admin/*.`,
        type: "invalid_request_error",
        code: "unknown_endpoint",
      },
    }),
  );

  app.get("/health", async () => ({
    status: "ok",
    providers: ctx.providers.length,
    uptimeMs: Date.now() - ctx.stats.startedAt,
  }));

  app.get("/", async () => ({
    name: "omniroute-gateway",
    endpoints: [
      "POST /v1/chat/completions",
      "POST /v1/messages",
      "GET /v1/models",
      "GET /admin/providers",
      "GET /admin/stats",
      "GET /health",
    ],
    providers: ctx.providers.length,
  }));

  await registerChatRoutes(app, ctx);
  await registerMessagesRoutes(app, ctx);
  await registerModelRoutes(app, ctx);
  await registerAdminRoutes(app, ctx);

  return app;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

declare module "fastify" {
  interface FastifyInstance {
    gateway: GatewayContext;
  }
}
