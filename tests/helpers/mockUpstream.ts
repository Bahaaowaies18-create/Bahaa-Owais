/**
 * A scriptable stand-in for `fetch`, so the suite can exercise routing,
 * fallback and stream translation without touching a real provider.
 */

export interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export type MockHandler = (call: MockCall) => Response | Promise<Response>;

export interface MockUpstream {
  fetchImpl: typeof fetch;
  calls: MockCall[];
  /** Calls that hit a chat/messages endpoint, in order. */
  chatCalls: MockCall[];
}

/**
 * Build a fetch whose behaviour is chosen by the first matching route key.
 * Keys are matched as substrings of the request URL, longest key first, so
 * "groq.com/openai/v1/chat" wins over "groq.com".
 */
export function createMockUpstream(
  routes: Record<string, MockHandler>,
): MockUpstream {
  const calls: MockCall[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);

  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: MockCall = {
      url,
      method: init?.method ?? "GET",
      headers: normaliseHeaders(init?.headers),
      body,
    };
    calls.push(call);

    const key = keys.find((k) => url.includes(k));
    if (!key) {
      return jsonResponse({ error: { message: `no mock route for ${url}` } }, 404);
    }
    return routes[key]!(call);
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    calls,
    get chatCalls() {
      return calls.filter(
        (c) => c.url.includes("/chat/completions") || c.url.endsWith("/messages"),
      );
    },
  };
}

function normaliseHeaders(
  headers: RequestInit["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[String(key).toLowerCase()] = String(value);
  } else {
    for (const [key, value] of Object.entries(headers)) {
      out[key.toLowerCase()] = String(value);
    }
  }
  return out;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `GET /models` payload in the shape every provider uses. */
export function modelsResponse(ids: string[]): Response {
  return jsonResponse({
    object: "list",
    data: ids.map((id) => ({ id, object: "model", owned_by: "mock" })),
  });
}

/** An OpenAI-shaped non-streaming completion. */
export function chatResponse(
  content: string,
  overrides: Record<string, unknown> = {},
): Response {
  return jsonResponse({
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: 1_700_000_000,
    model: "mock-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...overrides,
  });
}

/** Serialise SSE frames into a streaming Response body. */
export function sseResponse(
  frames: Array<string | { event?: string; data: string }>,
  status = 200,
  delayMs = 0,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const frame of frames) {
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        const text =
          typeof frame === "string"
            ? `data: ${frame}\n\n`
            : `${frame.event ? `event: ${frame.event}\n` : ""}data: ${frame.data}\n\n`;
        controller.enqueue(encoder.encode(text));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

/** OpenAI-dialect streaming frames for a short answer. */
export function openAIStreamFrames(words: string[]): string[] {
  const base = {
    id: "chatcmpl-stream",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "mock-model",
  };
  const frames = words.map((word, i) =>
    JSON.stringify({
      ...base,
      choices: [
        {
          index: 0,
          delta: i === 0 ? { role: "assistant", content: word } : { content: word },
        },
      ],
    }),
  );
  frames.push(
    JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    }),
  );
  frames.push("[DONE]");
  return frames;
}

/** Anthropic-dialect streaming frames for a short answer. */
export function anthropicStreamFrames(
  words: string[],
): Array<{ event: string; data: string }> {
  const frames: Array<{ event: string; data: string }> = [
    {
      event: "message_start",
      data: JSON.stringify({
        type: "message_start",
        message: {
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: "claude-mock",
          content: [],
          stop_reason: null,
          usage: { input_tokens: 12, output_tokens: 0 },
        },
      }),
    },
    {
      event: "content_block_start",
      data: JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
    },
  ];
  for (const word of words) {
    frames.push({
      event: "content_block_delta",
      data: JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: word },
      }),
    });
  }
  frames.push(
    {
      event: "content_block_stop",
      data: JSON.stringify({ type: "content_block_stop", index: 0 }),
    },
    {
      event: "message_delta",
      data: JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: words.length },
      }),
    },
    { event: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
  );
  return frames;
}

/** Parse an SSE payload captured from a response body. */
export function parseSSEPayload(
  payload: string,
): Array<{ event?: string; data: string }> {
  const events: Array<{ event?: string; data: string }> = [];
  for (const block of payload.replace(/\r\n/g, "\n").split("\n\n")) {
    if (!block.trim()) continue;
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length) {
      events.push(event ? { event, data: dataLines.join("\n") } : { data: dataLines.join("\n") });
    }
  }
  return events;
}
