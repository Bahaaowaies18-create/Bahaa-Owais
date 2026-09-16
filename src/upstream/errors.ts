/** Normalised upstream failure, plus whether it is worth trying elsewhere. */
export class UpstreamError extends Error {
  readonly providerId: string;
  readonly status: number;
  /** True when another provider might succeed with the same request. */
  readonly retryable: boolean;
  /** True when the provider itself looks broken (counts against the breaker). */
  readonly providerFault: boolean;
  readonly body: unknown;
  readonly retryAfterMs: number | null;

  constructor(opts: {
    providerId: string;
    status: number;
    message: string;
    retryable: boolean;
    providerFault: boolean;
    body?: unknown;
    retryAfterMs?: number | null;
  }) {
    super(opts.message);
    this.name = "UpstreamError";
    this.providerId = opts.providerId;
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.providerFault = opts.providerFault;
    this.body = opts.body ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
  }
}

/** Client-visible error with an explicit HTTP status. */
export class GatewayError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(
    status: number,
    message: string,
    opts: { type?: string; code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.type = opts.type ?? "invalid_request_error";
    this.code = opts.code;
    this.details = opts.details ?? null;
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function extractMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.slice(0, 500);
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const msg = (error as Record<string, unknown>).message;
      if (typeof msg === "string") return msg;
    }
    if (typeof record.message === "string") return record.message;
    if (typeof record.detail === "string") return record.detail;
  }
  return fallback;
}

/**
 * Classify a non-2xx upstream response.
 *
 * The distinction that matters: `retryable` decides whether to try the next
 * provider, `providerFault` decides whether this provider's breaker should
 * trip. A 400 is neither — the request is simply wrong and every provider will
 * say so. A 401 is a provider fault (our key is bad) but is also worth
 * retrying elsewhere, since another provider's key may be fine.
 */
export function classifyHttpError(
  providerId: string,
  status: number,
  body: unknown,
  headers?: Headers,
): UpstreamError {
  const retryAfterMs = parseRetryAfter(headers?.get("retry-after") ?? null);
  const message = extractMessage(body, `${providerId} returned HTTP ${status}`);

  // 408 request timeout, 409 conflict and 429 rate limit are all transient.
  const transient = status === 408 || status === 409 || status === 429;
  const serverSide = status >= 500;
  const authProblem = status === 401 || status === 403;
  // 404 usually means "this provider does not serve that model".
  const notFound = status === 404;

  return new UpstreamError({
    providerId,
    status,
    message,
    retryable: transient || serverSide || authProblem || notFound,
    providerFault: serverSide || authProblem || status === 429,
    body,
    retryAfterMs,
  });
}

/** Classify a transport-level failure (DNS, TCP, TLS, abort). */
export function classifyNetworkError(
  providerId: string,
  err: unknown,
): UpstreamError {
  const isAbort =
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError");
  const message = isAbort
    ? `${providerId} timed out`
    : `${providerId} is unreachable: ${(err as Error)?.message ?? String(err)}`;
  return new UpstreamError({
    providerId,
    status: isAbort ? 504 : 502,
    message,
    retryable: true,
    providerFault: true,
    body: null,
  });
}
