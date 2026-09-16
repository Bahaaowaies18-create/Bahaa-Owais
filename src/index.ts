import "dotenv/config";
import { loadConfig } from "./config/load.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });

  const ctx = app.gateway;
  if (ctx.providers.length === 0) {
    app.log.warn(
      "No providers are configured. Copy .env.example to .env and set at least one API key " +
        "(GROQ_API_KEY, GOOGLE_API_KEY and CEREBRAS_API_KEY all have free tiers).",
    );
  } else {
    app.log.info(
      { providers: ctx.providers.map((p) => p.id) },
      `${ctx.providers.length} provider(s) registered`,
    );
  }

  // Warm the model index so the first request does not pay for discovery.
  void ctx.modelIndex.refreshAll(ctx.providers).catch(() => undefined);

  await app.listen({ host: config.host, port: config.port });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start omniroute-gateway:", err);
  process.exit(1);
});
