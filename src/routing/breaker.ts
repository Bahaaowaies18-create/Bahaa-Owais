import type { RetryPolicy } from "../config/types.js";

interface BreakerState {
  consecutiveFailures: number;
  /** Number of times the breaker has opened; drives the backoff. */
  trips: number;
  openUntil: number;
  lastError: string | null;
}

export interface ProviderHealth {
  providerId: string;
  open: boolean;
  openUntil: number | null;
  consecutiveFailures: number;
  lastError: string | null;
}

/**
 * Per-provider circuit breaker.
 *
 * After `breakerThreshold` consecutive faults a provider is skipped for a
 * cooldown that doubles with each further trip, capped at
 * `breakerMaxCooldownMs`. A single success closes it again.
 *
 * The router may still use an open provider as a last resort — being degraded
 * beats returning no answer at all — which doubles as the half-open probe.
 */
export class CircuitBreaker {
  private readonly states = new Map<string, BreakerState>();

  constructor(
    private readonly policy: Pick<
      RetryPolicy,
      "breakerThreshold" | "breakerCooldownMs" | "breakerMaxCooldownMs"
    >,
    private readonly now: () => number = Date.now,
  ) {}

  private state(providerId: string): BreakerState {
    let state = this.states.get(providerId);
    if (!state) {
      state = { consecutiveFailures: 0, trips: 0, openUntil: 0, lastError: null };
      this.states.set(providerId, state);
    }
    return state;
  }

  isOpen(providerId: string): boolean {
    const state = this.states.get(providerId);
    if (!state) return false;
    if (state.openUntil === 0) return false;
    if (state.openUntil <= this.now()) {
      // Cooldown elapsed: go half-open so the next request can probe it.
      state.openUntil = 0;
      state.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(providerId: string): void {
    const state = this.state(providerId);
    state.consecutiveFailures = 0;
    state.trips = 0;
    state.openUntil = 0;
    state.lastError = null;
  }

  /** Record a fault. Returns true when this failure opened the breaker. */
  recordFailure(providerId: string, error?: string): boolean {
    const state = this.state(providerId);
    state.consecutiveFailures += 1;
    if (error) state.lastError = error;
    if (state.consecutiveFailures < this.policy.breakerThreshold) return false;

    const backoff = this.policy.breakerCooldownMs * 2 ** state.trips;
    state.trips += 1;
    state.openUntil =
      this.now() + Math.min(backoff, this.policy.breakerMaxCooldownMs);
    state.consecutiveFailures = 0;
    return true;
  }

  /** Hold a provider open for at least `ms` — used to honour Retry-After. */
  holdOpen(providerId: string, ms: number, error?: string): void {
    if (ms <= 0) return;
    const state = this.state(providerId);
    if (error) state.lastError = error;
    const until = this.now() + Math.min(ms, this.policy.breakerMaxCooldownMs);
    state.openUntil = Math.max(state.openUntil, until);
  }

  snapshot(): ProviderHealth[] {
    return [...this.states.entries()].map(([providerId, state]) => ({
      providerId,
      open: state.openUntil > this.now(),
      openUntil: state.openUntil > 0 ? state.openUntil : null,
      consecutiveFailures: state.consecutiveFailures,
      lastError: state.lastError,
    }));
  }

  reset(): void {
    this.states.clear();
  }
}
