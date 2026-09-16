import type { FastifyReply } from "fastify";

/**
 * Take over the raw socket for a server-sent-events response.
 *
 * Fastify's reply lifecycle assumes one buffered payload, so streaming
 * endpoints hijack the reply and write frames directly.
 */
export function beginSSE(
  reply: FastifyReply,
  extraHeaders: Record<string, string> = {},
): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Stop nginx and friends from buffering the stream into uselessness.
    "x-accel-buffering": "no",
    ...extraHeaders,
  });
  reply.raw.flushHeaders?.();
}

export function writeSSE(
  reply: FastifyReply,
  data: string,
  event?: string,
): void {
  if (reply.raw.writableEnded) return;
  if (event) reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${data}\n\n`);
}

export function endSSE(reply: FastifyReply): void {
  if (!reply.raw.writableEnded) reply.raw.end();
}

/**
 * Report a failure that happened after the stream was already committed.
 *
 * The status line is long gone at this point, so the only honest option is to
 * emit an error frame and close; clients surface it instead of silently
 * treating a truncated answer as complete.
 */
export function writeStreamError(
  reply: FastifyReply,
  message: string,
  type = "api_error",
): void {
  writeSSE(reply, JSON.stringify({ error: { message, type } }), "error");
  endSSE(reply);
}
