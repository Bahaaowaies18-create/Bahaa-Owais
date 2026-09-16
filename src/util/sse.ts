/**
 * Minimal server-sent-events helpers.
 *
 * Upstream SSE bodies arrive as byte chunks that do not respect event
 * boundaries, so the parser buffers until it sees a blank line.
 */

export interface SSEEvent {
  /** The `event:` field, when the producer sent one. */
  event?: string;
  /** The concatenated `data:` lines. */
  data: string;
}

/** Serialise one event for the wire. */
export function formatSSE(data: string, event?: string): string {
  const head = event ? `event: ${event}\n` : "";
  return `${head}data: ${data}\n\n`;
}

/**
 * Turn a byte stream into decoded SSE events.
 *
 * Leading/trailing whitespace and `:` comment lines (heartbeats) are dropped.
 * Events with no data lines are skipped entirely.
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Normalise CRLF so the blank-line split below works for every producer.
      buffer = buffer.replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseEventBlock(raw);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    const tail = parseEventBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseEventBlock(block: string): SSEEvent | null {
  const lines = block.split("\n");
  const dataLines: string[] = [];
  let event: string | undefined;
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // A single leading space after the colon is part of the framing, not data.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
  }
  if (dataLines.length === 0) return null;
  return event === undefined
    ? { data: dataLines.join("\n") }
    : { event, data: dataLines.join("\n") };
}
