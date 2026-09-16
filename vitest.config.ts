import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each suite boots its own Fastify instances on ephemeral ports; running
    // files in parallel is fine, but keep the pool small in CI containers.
    pool: "forks",
    testTimeout: 20_000,
  },
});
