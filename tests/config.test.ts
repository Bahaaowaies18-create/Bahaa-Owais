import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseBool, parseIntOr, parseList, readConfigFile } from "../src/config/load.js";

function writeConfig(contents: unknown | string): string {
  const dir = mkdtempSync(join(tmpdir(), "omniroute-"));
  const path = join(dir, "gateway.json");
  writeFileSync(
    path,
    typeof contents === "string" ? contents : JSON.stringify(contents),
  );
  return path;
}

describe("primitive parsers", () => {
  it("reads booleans permissively", () => {
    for (const truthy of ["1", "true", "TRUE", " yes ", "on"]) {
      expect(parseBool(truthy)).toBe(true);
    }
    for (const falsy of ["0", "false", "no", "off", "", undefined]) {
      expect(parseBool(falsy)).toBe(false);
    }
    expect(parseBool(undefined, true)).toBe(true);
  });

  it("falls back on non-positive or unparseable integers", () => {
    expect(parseIntOr("42", 7)).toBe(42);
    expect(parseIntOr("0", 7)).toBe(7);
    expect(parseIntOr("-5", 7)).toBe(7);
    expect(parseIntOr("abc", 7)).toBe(7);
    expect(parseIntOr(undefined, 7)).toBe(7);
  });

  it("splits and trims comma lists", () => {
    expect(parseList(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe("loadConfig", () => {
  it("uses safe defaults with an empty environment", () => {
    const config = loadConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8787);
    expect(config.apiKeys).toEqual([]);
    expect(config.routing.fallbackForPinnedModels).toBe(false);
    expect(config.retry.maxAttempts).toBe(3);
  });

  it("reads gateway settings from the environment", () => {
    const config = loadConfig({
      HOST: "0.0.0.0",
      PORT: "9000",
      GATEWAY_API_KEYS: "a, b",
      MAX_ATTEMPTS: "5",
      ROUTING_PREFER: "local",
      FALLBACK_FOR_PINNED_MODELS: "true",
    });
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9000);
    expect(config.apiKeys).toEqual(["a", "b"]);
    expect(config.retry.maxAttempts).toBe(5);
    expect(config.routing.prefer).toBe("local");
    expect(config.routing.fallbackForPinnedModels).toBe(true);
  });

  it("ignores an unrecognised preference", () => {
    expect(loadConfig({ ROUTING_PREFER: "cheapest" }).routing.prefer).toBe("free");
  });

  it("layers a config file under the environment", () => {
    const path = writeConfig({
      routing: { prefer: "priority" },
      retry: { maxAttempts: 9, breakerThreshold: 5 },
      routes: [{ model: "auto-cheap", targets: ["groq/llama"] }],
      providers: [{ id: "mine", baseUrl: "https://mine.example/v1" }],
      disabledProviders: ["openai"],
      apiKeys: ["from-file"],
    });

    const config = loadConfig({ GATEWAY_CONFIG: path, MAX_ATTEMPTS: "2" });
    // Env wins over the file...
    expect(config.retry.maxAttempts).toBe(2);
    // ...while file-only settings survive.
    expect(config.retry.breakerThreshold).toBe(5);
    expect(config.routing.prefer).toBe("priority");
    expect(config.routes).toHaveLength(1);
    expect(config.customProviders[0]!.id).toBe("mine");
    expect(config.disabledProviders).toEqual(["openai"]);
    expect(config.apiKeys).toEqual(["from-file"]);
  });

  it("merges api keys from both sources without duplicates", () => {
    const path = writeConfig({ apiKeys: ["shared", "file-only"] });
    const config = loadConfig({
      GATEWAY_CONFIG: path,
      GATEWAY_API_KEYS: "shared,env-only",
    });
    expect(config.apiKeys).toEqual(["shared", "env-only", "file-only"]);
  });
});

describe("readConfigFile validation", () => {
  it("rejects a missing file with an actionable message", () => {
    expect(() => readConfigFile("/nope/gateway.json")).toThrow(
      /could not be read/,
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => readConfigFile(writeConfig("{ nope"))).toThrow(/not valid JSON/);
  });

  it("rejects a non-object top level", () => {
    expect(() => readConfigFile(writeConfig([1, 2, 3]))).toThrow(
      /JSON object at the top level/,
    );
  });

  it("rejects a provider with no baseUrl", () => {
    expect(() => readConfigFile(writeConfig({ providers: [{ id: "x" }] }))).toThrow(
      /"id" and "baseUrl"/,
    );
  });

  it("rejects an unknown wire format", () => {
    expect(() =>
      readConfigFile(
        writeConfig({ providers: [{ id: "x", baseUrl: "u", wire: "grpc" }] }),
      ),
    ).toThrow(/unknown wire format/);
  });

  it("rejects a route with no targets", () => {
    expect(() =>
      readConfigFile(writeConfig({ routes: [{ model: "auto", targets: [] }] })),
    ).toThrow(/non-empty "targets"/);
  });

  it("accepts the shipped example config", () => {
    const file = readConfigFile("config/gateway.example.json");
    expect(file.routes?.length).toBeGreaterThan(0);
    expect(file.providers?.length).toBeGreaterThan(0);
  });
});
