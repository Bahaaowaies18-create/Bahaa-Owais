import type { ResolvedProvider, RetryPolicy } from "../config/types.js";
import type { Stats } from "../observability/stats.js";
import { providerHeaders } from "../providers/registry.js";
import type { CircuitBreaker } from "../routing/breaker.js";
import type { Candidate } from "../routing/router.js";
import type { AnthropicResponse } from "../translate/anthropic-types.js";
import type {
  OpenAIChatChunk,
  OpenAIChatRequest,
  OpenAIChatResponse,
} from "../translate/openai-types.js";
import { openAIRequestToAnthropic } from "../translate/request.js";
import {
  AnthropicToOpenAIStream,
  anthropicResponseToOpenAI,
} from "../translate/response.js";
import { parseSSE } from "../util/sse.js";
import {
  classifyHttpError,
  classifyNetworkError,
  GatewayError,
  UpstreamError,
} from "./errors.js";

export interface DispatchDeps {
  breaker: CircuitBreaker;
  policy: RetryPolicy;
  stats: Stats;
  fetchImpl?: typeof fetch;
  log?: (event: Record<string, unknown>) => void;
}

/** One upstream try, recorded for the response headers and the logs. */
export interface AttemptLog {
  providerId: string;
  model: string;
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

export interface DispatchResult<T> {
  value: T;
  candidate: Candidate;
  attempts: AttemptLog[];
}

function endpointFor(provider: ResolvedProvider): string {
  return provider.wire === "anthropic"
    ? `${provider.baseUrl}/messages`
    : `${provider.baseUrl}/chat/completions`;
}

/** Build the upstream body for a candidate, translating if the wire differs. */
export function bodyFor(
  candidate: Candidate,
  request: OpenAIChatRequest,
  stream: boolean,
): Record<string, unknown> {
  if (candidate.provider.wire === "anthropic") {
    return {
      ...openAIRequestToAnthropic(request, candidate.model),
      stream,
    } as Record<string, unknown>;
  }
  const body: Record<string, unknown> = {
    ...request,
    model: candidate.model,
    stream,
  };
  if (!stream) delete body.stream_options;
  return body;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Walk the candidate list until one succeeds.
 *
 * `attempt` performs a single upstream call and must throw an `UpstreamError`
 * for anything the next provider could plausibly fix. Non-retryable errors
 * (a malformed request, for instance) stop the walk immediately, because
 * asking a second provider the same bad question only wastes time.
 */
async function withFallback<T>(
  candidates: Candidate[],
  deps: DispatchDeps,
  attempt: (candidate: Candidate) => Promise<T>,
): Promise<DispatchResult<T>> {
  const attempts: AttemptLog[] = [];
  const maxAttempts = Math.max(1, deps.policy.maxAttempts);
  let lastError: UpstreamError | null = null;

  for (const candidate of candidates.slice(0, maxAttempts)) {
    const startedAt = Date.now();
    deps.stats.recordAttempt(candidate.provider.id);
    try {
      const value = await attempt(candidate);
      const latencyMs = Date.now() - startedAt;
      attempts.push({
        providerId: candidate.provider.id,
        model: candidate.model,
        ok: true,
        latencyMs,
      });
      deps.breaker.recordSuccess(candidate.provider.id);
      return { value, candidate, attempts };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const upstream =
        err instanceof UpstreamError
          ? err
          : classifyNetworkError(candidate.provider.id, err);
      attempts.push({
        providerId: candidate.provider.id,
        model: candidate.model,
        ok: false,
        status: upstream.status,
        latencyMs,
        error: upstream.message,
      });
      deps.stats.recordFailure(candidate.provider.id);
      if (upstream.providerFault) {
        deps.breaker.recordFailure(candidate.provider.id, upstream.message);
      }
      if (upstream.retryAfterMs) {
        deps.breaker.holdOpen(
          candidate.provider.id,
          upstream.retryAfterMs,
          upstream.message,
        );
      }
      deps.log?.({
        msg: "upstream attempt failed",
        provider: candidate.provider.id,
        model: candidate.model,
        status: upstream.status,
        retryable: upstream.retryable,
        error: upstream.message,
      });
      lastError = upstream;
      if (!upstream.retryable) break;
      deps.stats.recordFallback(candidate.provider.id);
    }
  }

  throw new GatewayError(
    lastError?.status ?? 502,
    lastError
      ? `All ${attempts.length} provider attempt(s) failed. Last error: ${lastError.message}`
      : "No provider candidates were available for this request.",
    {
      type: "api_error",
      code: "all_providers_failed",
      details: attempts,
    },
  );
}

/** Non-streaming chat completion with automatic provider fallback. */
export async function dispatchChat(
  request: OpenAIChatRequest,
  candidates: Candidate[],
  deps: DispatchDeps,
): Promise<DispatchResult<OpenAIChatResponse>> {
  const doFetch = deps.fetchImpl ?? fetch;
  const requestedModel = request.model;

  return withFallback(candidates, deps, async (candidate) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      deps.policy.requestTimeoutMs,
    );
    const startedAt = Date.now();
    try {
      const res = await doFetch(endpointFor(candidate.provider), {
        method: "POST",
        headers: providerHeaders(candidate.provider),
        body: JSON.stringify(bodyFor(candidate, request, false)),
        signal: controller.signal,
      });
      const body = await readBody(res);
      if (!res.ok) {
        throw classifyHttpError(
          candidate.provider.id,
          res.status,
          body,
          res.headers,
        );
      }
      const normalised =
        candidate.provider.wire === "anthropic"
          ? anthropicResponseToOpenAI(body as AnthropicResponse, requestedModel)
          : ({ ...(body as OpenAIChatResponse), model: requestedModel });

      deps.stats.recordSuccess(
        candidate.provider.id,
        candidate.model,
        Date.now() - startedAt,
        normalised.usage,
      );
      return normalised;
    } catch (err) {
      if (err instanceof UpstreamError) throw err;
      throw classifyNetworkError(candidate.provider.id, err);
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Streaming chat completion with fallback *before the first token*.
 *
 * Once a byte has been handed to the client there is no way to switch
 * providers without corrupting the stream, so the first chunk is awaited here,
 * inside the fallback loop. A provider that 500s or stalls before producing
 * anything is still swappable; one that fails mid-answer is not.
 */
export async function dispatchChatStream(
  request: OpenAIChatRequest,
  candidates: Candidate[],
  deps: DispatchDeps,
): Promise<DispatchResult<AsyncGenerator<OpenAIChatChunk>>> {
  const doFetch = deps.fetchImpl ?? fetch;
  const requestedModel = request.model;
  const includeUsage = Boolean(
    (request.stream_options as { include_usage?: boolean } | undefined)
      ?.include_usage,
  );

  return withFallback(candidates, deps, async (candidate) => {
    const controller = new AbortController();
    const overallTimer = setTimeout(
      () => controller.abort(),
      deps.policy.requestTimeoutMs,
    );
    let firstTokenTimer: NodeJS.Timeout | undefined;
    const startedAt = Date.now();

    let res: Response;
    try {
      firstTokenTimer = setTimeout(
        () => controller.abort(),
        deps.policy.streamFirstTokenTimeoutMs,
      );
      res = await doFetch(endpointFor(candidate.provider), {
        method: "POST",
        headers: {
          ...providerHeaders(candidate.provider),
          accept: "text/event-stream",
        },
        body: JSON.stringify(bodyFor(candidate, request, true)),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(overallTimer);
      clearTimeout(firstTokenTimer);
      throw classifyNetworkError(candidate.provider.id, err);
    }

    if (!res.ok) {
      clearTimeout(overallTimer);
      clearTimeout(firstTokenTimer);
      const body = await readBody(res);
      throw classifyHttpError(
        candidate.provider.id,
        res.status,
        body,
        res.headers,
      );
    }
    if (!res.body) {
      clearTimeout(overallTimer);
      clearTimeout(firstTokenTimer);
      throw new UpstreamError({
        providerId: candidate.provider.id,
        status: 502,
        message: `${candidate.provider.id} returned an empty stream body`,
        retryable: true,
        providerFault: true,
      });
    }

    const chunks = toOpenAIChunks(
      res.body,
      candidate,
      requestedModel,
      includeUsage,
    );

    // Pull the first chunk here so a provider that dies before producing
    // output is still eligible for fallback.
    let first: IteratorResult<OpenAIChatChunk>;
    try {
      first = await chunks.next();
    } catch (err) {
      clearTimeout(overallTimer);
      clearTimeout(firstTokenTimer);
      if (err instanceof UpstreamError) throw err;
      throw classifyNetworkError(candidate.provider.id, err);
    }
    clearTimeout(firstTokenTimer);

    if (first.done) {
      clearTimeout(overallTimer);
      throw new UpstreamError({
        providerId: candidate.provider.id,
        status: 502,
        message: `${candidate.provider.id} closed the stream without sending any content`,
        retryable: true,
        providerFault: true,
      });
    }

    const firstChunk = first.value;
    async function* replay(): AsyncGenerator<OpenAIChatChunk> {
      try {
        yield firstChunk;
        let usage: OpenAIChatChunk["usage"];
        for await (const chunk of chunks) {
          if (chunk.usage) usage = chunk.usage;
          yield chunk;
        }
        deps.stats.recordSuccess(
          candidate.provider.id,
          candidate.model,
          Date.now() - startedAt,
          usage ?? undefined,
        );
      } finally {
        clearTimeout(overallTimer);
        // Abort so the socket is released even when the client hangs up early.
        controller.abort();
      }
    }

    return replay();
  });
}

/** Decode an upstream SSE body into canonical OpenAI chunks. */
async function* toOpenAIChunks(
  body: ReadableStream<Uint8Array>,
  candidate: Candidate,
  requestedModel: string,
  includeUsage: boolean,
): AsyncGenerator<OpenAIChatChunk> {
  if (candidate.provider.wire === "anthropic") {
    const translator = new AnthropicToOpenAIStream(requestedModel, includeUsage);
    for await (const event of parseSSE(body)) {
      if (event.event === "error" || isErrorPayload(event.data)) {
        throw new UpstreamError({
          providerId: candidate.provider.id,
          status: 502,
          message: `${candidate.provider.id} sent an error event: ${event.data.slice(0, 300)}`,
          retryable: true,
          providerFault: true,
        });
      }
      for (const chunk of translator.push(event)) yield chunk;
    }
    return;
  }

  for await (const event of parseSSE(body)) {
    const data = event.data.trim();
    if (data === "[DONE]") return;
    let parsed: OpenAIChatChunk;
    try {
      parsed = JSON.parse(data) as OpenAIChatChunk;
    } catch {
      continue;
    }
    // Some providers deliver errors as a normal SSE frame mid-stream.
    if ((parsed as unknown as { error?: unknown }).error) {
      throw new UpstreamError({
        providerId: candidate.provider.id,
        status: 502,
        message: `${candidate.provider.id} sent an error event: ${data.slice(0, 300)}`,
        retryable: true,
        providerFault: true,
      });
    }
    // Report the model the client asked for, not the upstream alias.
    yield { ...parsed, model: requestedModel };
  }
}

function isErrorPayload(data: string): boolean {
  if (!data.includes('"error"')) return false;
  try {
    const parsed = JSON.parse(data) as { type?: string; error?: unknown };
    return parsed.type === "error" || Boolean(parsed.error);
  } catch {
    return false;
  }
}
