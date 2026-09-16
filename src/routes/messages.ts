import type { FastifyInstance } from "fastify";
import type { GatewayContext } from "../server.js";
import type { AnthropicRequest } from "../translate/anthropic-types.js";
import { anthropicRequestToOpenAI } from "../translate/request.js";
import {
  OpenAIToAnthropicStream,
  openAIResponseToAnthropic,
} from "../translate/response.js";
import { dispatchChat, dispatchChatStream } from "../upstream/dispatch.js";
import { GatewayError } from "../upstream/errors.js";
import { beginSSE, endSSE, writeSSE, writeStreamError } from "./sse.js";

export function validateMessagesRequest(body: unknown): AnthropicRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GatewayError(400, "Request body must be a JSON object.");
  }
  const req = body as AnthropicRequest;
  if (typeof req.model !== "string" || req.model.trim() === "") {
    throw new GatewayError(400, '"model" is required and must be a string.', {
      code: "missing_model",
    });
  }
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new GatewayError(
      400,
      '"messages" is required and must be a non-empty array.',
      { code: "missing_messages" },
    );
  }
  return req;
}

/**
 * Anthropic-native surface.
 *
 * Requests are translated into the canonical OpenAI shape, routed through the
 * same fallback machinery as /v1/chat/completions, and translated back. That
 * means an Anthropic-speaking client (Claude Code, the Anthropic SDKs) can be
 * served by a provider that has never heard of the Messages API.
 */
export async function registerMessagesRoutes(
  app: FastifyInstance,
  ctx: GatewayContext,
): Promise<void> {
  app.post("/v1/messages", async (request, reply) => {
    const anthropicReq = validateMessagesRequest(request.body);
    const canonical = anthropicRequestToOpenAI(anthropicReq);
    const { candidates, via } = await ctx.router.resolve(canonical.model);
    const deps = {
      breaker: ctx.breaker,
      policy: ctx.config.retry,
      stats: ctx.stats,
      fetchImpl: ctx.fetchImpl,
      log: (event: Record<string, unknown>) => request.log.warn(event),
    };

    if (!anthropicReq.stream) {
      const { value, candidate, attempts } = await dispatchChat(
        canonical,
        candidates,
        deps,
      );
      return reply
        .headers({
          "x-omniroute-provider": candidate.provider.id,
          "x-omniroute-model": candidate.model,
          "x-omniroute-attempts": String(attempts.length),
          "x-omniroute-route": via,
        })
        .send(openAIResponseToAnthropic(value, anthropicReq.model));
    }

    // Usage totals only reach the Anthropic message_delta frame if the
    // upstream reports them, so ask OpenAI-dialect providers for them.
    const streamingReq = {
      ...canonical,
      stream: true,
      stream_options: { include_usage: true },
    };
    const { value: chunks, candidate, attempts } = await dispatchChatStream(
      streamingReq,
      candidates,
      deps,
    );

    beginSSE(reply, {
      "x-omniroute-provider": candidate.provider.id,
      "x-omniroute-model": candidate.model,
      "x-omniroute-attempts": String(attempts.length),
      "x-omniroute-route": via,
    });

    let clientGone = false;
    request.raw.on("close", () => {
      clientGone = true;
    });

    const translator = new OpenAIToAnthropicStream(anthropicReq.model);
    try {
      for await (const chunk of chunks) {
        if (clientGone) break;
        for (const frame of translator.push(chunk)) {
          writeSSE(reply, frame.data, frame.event);
        }
      }
      if (!clientGone) {
        for (const frame of translator.finish()) {
          writeSSE(reply, frame.data, frame.event);
        }
      }
      endSSE(reply);
    } catch (err) {
      request.log.error({ err }, "messages stream failed after first token");
      writeStreamError(
        reply,
        `Stream from ${candidate.provider.id} failed: ${(err as Error).message}`,
        "overloaded_error",
      );
    }
    return reply;
  });
}
