import type { FastifyInstance } from "fastify";
import type { GatewayContext } from "../server.js";
import type { OpenAIChatRequest } from "../translate/openai-types.js";
import { dispatchChat, dispatchChatStream } from "../upstream/dispatch.js";
import { GatewayError } from "../upstream/errors.js";
import { beginSSE, endSSE, writeSSE, writeStreamError } from "./sse.js";

/** Reject obviously malformed requests before spending an upstream call. */
export function validateChatRequest(body: unknown): OpenAIChatRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GatewayError(400, "Request body must be a JSON object.");
  }
  const req = body as OpenAIChatRequest;
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

export async function registerChatRoutes(
  app: FastifyInstance,
  ctx: GatewayContext,
): Promise<void> {
  app.post("/v1/chat/completions", async (request, reply) => {
    const body = validateChatRequest(request.body);
    const { candidates, via } = await ctx.router.resolve(body.model);
    const deps = {
      breaker: ctx.breaker,
      policy: ctx.config.retry,
      stats: ctx.stats,
      fetchImpl: ctx.fetchImpl,
      log: (event: Record<string, unknown>) => request.log.warn(event),
    };

    if (!body.stream) {
      const { value, candidate, attempts } = await dispatchChat(
        body,
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
        .send(value);
    }

    // Fallback happens inside dispatchChatStream, before the first chunk, so
    // an error here can still be returned as an ordinary JSON error response.
    const { value: chunks, candidate, attempts } = await dispatchChatStream(
      body,
      candidates,
      deps,
    );

    beginSSE(reply, {
      "x-omniroute-provider": candidate.provider.id,
      "x-omniroute-model": candidate.model,
      "x-omniroute-attempts": String(attempts.length),
      "x-omniroute-route": via,
    });

    // If the client disconnects, stop pulling from the upstream provider.
    let clientGone = false;
    request.raw.on("close", () => {
      clientGone = true;
    });

    try {
      for await (const chunk of chunks) {
        if (clientGone) break;
        writeSSE(reply, JSON.stringify(chunk));
      }
      if (!clientGone) {
        writeSSE(reply, "[DONE]");
      }
      endSSE(reply);
    } catch (err) {
      request.log.error({ err }, "stream failed after first token");
      writeStreamError(
        reply,
        `Stream from ${candidate.provider.id} failed: ${(err as Error).message}`,
      );
    }
    return reply;
  });
}
