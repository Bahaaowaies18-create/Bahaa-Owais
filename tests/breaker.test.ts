import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/routing/breaker.js";

const policy = {
  breakerThreshold: 3,
  breakerCooldownMs: 1_000,
  breakerMaxCooldownMs: 10_000,
};

function makeBreaker() {
  let now = 0;
  const breaker = new CircuitBreaker(policy, () => now);
  return {
    breaker,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

describe("CircuitBreaker", () => {
  it("stays closed below the failure threshold", () => {
    const { breaker } = makeBreaker();
    breaker.recordFailure("groq");
    breaker.recordFailure("groq");
    expect(breaker.isOpen("groq")).toBe(false);
  });

  it("opens on the threshold failure", () => {
    const { breaker } = makeBreaker();
    expect(breaker.recordFailure("groq")).toBe(false);
    expect(breaker.recordFailure("groq")).toBe(false);
    expect(breaker.recordFailure("groq")).toBe(true);
    expect(breaker.isOpen("groq")).toBe(true);
  });

  it("closes again once the cooldown elapses", () => {
    const { breaker, advance } = makeBreaker();
    for (let i = 0; i < 3; i++) breaker.recordFailure("groq");
    expect(breaker.isOpen("groq")).toBe(true);
    advance(999);
    expect(breaker.isOpen("groq")).toBe(true);
    advance(2);
    expect(breaker.isOpen("groq")).toBe(false);
  });

  it("doubles the cooldown on each successive trip", () => {
    const { breaker, advance } = makeBreaker();
    for (let i = 0; i < 3; i++) breaker.recordFailure("groq");
    advance(1_001);
    expect(breaker.isOpen("groq")).toBe(false);

    // Second trip: cooldown should now be 2s, not 1s.
    for (let i = 0; i < 3; i++) breaker.recordFailure("groq");
    advance(1_001);
    expect(breaker.isOpen("groq")).toBe(true);
    advance(1_000);
    expect(breaker.isOpen("groq")).toBe(false);
  });

  it("caps the cooldown at the configured maximum", () => {
    const { breaker, advance } = makeBreaker();
    for (let trip = 0; trip < 8; trip++) {
      for (let i = 0; i < 3; i++) breaker.recordFailure("groq");
      advance(policy.breakerMaxCooldownMs + 1);
      expect(breaker.isOpen("groq")).toBe(false);
    }
  });

  it("resets the failure count on success", () => {
    const { breaker } = makeBreaker();
    breaker.recordFailure("groq");
    breaker.recordFailure("groq");
    breaker.recordSuccess("groq");
    expect(breaker.recordFailure("groq")).toBe(false);
    expect(breaker.isOpen("groq")).toBe(false);
  });

  it("honours an explicit hold from Retry-After", () => {
    const { breaker, advance } = makeBreaker();
    breaker.holdOpen("groq", 5_000, "rate limited");
    expect(breaker.isOpen("groq")).toBe(true);
    advance(5_001);
    expect(breaker.isOpen("groq")).toBe(false);
  });

  it("never holds longer than the maximum cooldown", () => {
    const { breaker, advance } = makeBreaker();
    breaker.holdOpen("groq", 60 * 60_000);
    advance(policy.breakerMaxCooldownMs + 1);
    expect(breaker.isOpen("groq")).toBe(false);
  });

  it("reports health per provider", () => {
    const { breaker } = makeBreaker();
    for (let i = 0; i < 3; i++) breaker.recordFailure("groq", "boom");
    breaker.recordSuccess("openai");
    const snapshot = breaker.snapshot();
    expect(snapshot.find((s) => s.providerId === "groq")).toMatchObject({
      open: true,
      lastError: "boom",
    });
    expect(snapshot.find((s) => s.providerId === "openai")).toMatchObject({
      open: false,
    });
  });
});
