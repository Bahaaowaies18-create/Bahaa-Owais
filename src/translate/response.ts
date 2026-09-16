import { chatCompletionId, messageId, nowSeconds } from "../util/ids.js";
import type {
  AnthropicContentBlock,
  AnthropicResponse,
  AnthropicStopReason,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
} from "./anthropic-types.js";
import type {
  OpenAIChatChunk,
  OpenAIChatResponse,
  OpenAIFinishReason,
  OpenAIToolCall,
  OpenAIUsage,
} from "./openai-types.js";

// ---------------------------------------------------------------------------
// Anthropic response -> OpenAI response
// ---------------------------------------------------------------------------

export function stopReasonToFinishReason(
  reason: AnthropicStopReason,
): OpenAIFinishReason {
  switch (reason) {
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    case "refusal":
      return "content_filter";
    case "end_turn":
    case "stop_sequence":
    case "pause_turn":
      return "stop";
    default:
      return null;
  }
}

export function finishReasonToStopReason(
  reason: OpenAIFinishReason | undefined,
): AnthropicStopReason {
  switch (reason) {
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "refusal";
    case "stop":
      return "end_turn";
    default:
      return null;
  }
}

export function anthropicResponseToOpenAI(
  res: AnthropicResponse,
  requestedModel: string,
): OpenAIChatResponse {
  const blocks: AnthropicContentBlock[] = res.content ?? [];
  const text = blocks
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const toolCalls: OpenAIToolCall[] = blocks
    .filter((b): b is AnthropicToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      type: "function" as const,
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));

  const message: OpenAIChatResponse["choices"][number]["message"] = {
    role: "assistant",
    content: text || null,
  };
  if (toolCalls.length) message.tool_calls = toolCalls;

  const usage: OpenAIUsage | undefined = res.usage
    ? {
        prompt_tokens: res.usage.input_tokens ?? 0,
        completion_tokens: res.usage.output_tokens ?? 0,
        total_tokens:
          (res.usage.input_tokens ?? 0) + (res.usage.output_tokens ?? 0),
      }
    : undefined;

  return {
    id: res.id ?? chatCompletionId(),
    object: "chat.completion",
    created: nowSeconds(),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: stopReasonToFinishReason(res.stop_reason),
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

// ---------------------------------------------------------------------------
// OpenAI response -> Anthropic response (outbound /v1/messages)
// ---------------------------------------------------------------------------

export function openAIResponseToAnthropic(
  res: OpenAIChatResponse,
  requestedModel: string,
): AnthropicResponse {
  const choice = res.choices?.[0];
  const content: AnthropicContentBlock[] = [];
  const text = choice?.message?.content;
  if (typeof text === "string" && text.length > 0) {
    content.push({ type: "text", text });
  }
  for (const call of choice?.message?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(call.function.arguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      input = { _raw: call.function.arguments };
    }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }

  return {
    id: res.id ?? messageId(),
    type: "message",
    role: "assistant",
    model: requestedModel,
    content,
    stop_reason: finishReasonToStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Stream translation: Anthropic SSE -> OpenAI chunks
// ---------------------------------------------------------------------------

/**
 * Stateful translator from Anthropic streaming events to OpenAI chat chunks.
 *
 * One Anthropic event can produce zero, one, or several OpenAI chunks, so
 * `push` returns an array. Content-block indices are tracked because
 * Anthropic streams tool arguments as partial JSON under a block index while
 * OpenAI expects a `tool_calls[].index`.
 */
export class AnthropicToOpenAIStream {
  private id = chatCompletionId();
  private created = nowSeconds();
  private roleSent = false;
  private usage: OpenAIUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  /** Anthropic content-block index -> OpenAI tool_calls index. */
  private toolIndexByBlock = new Map<number, number>();
  private nextToolIndex = 0;
  private finishReason: OpenAIFinishReason = null;

  constructor(
    private readonly model: string,
    private readonly includeUsage: boolean,
  ) {}

  private chunk(
    delta: OpenAIChatChunk["choices"][number]["delta"],
    finishReason?: OpenAIFinishReason,
  ): OpenAIChatChunk {
    return {
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          delta,
          ...(finishReason !== undefined ? { finish_reason: finishReason } : {}),
        },
      ],
    };
  }

  push(event: { event?: string; data: string }): OpenAIChatChunk[] {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return [];
    }
    const type = (parsed.type as string) ?? event.event ?? "";
    const out: OpenAIChatChunk[] = [];

    switch (type) {
      case "message_start": {
        const message = parsed.message as
          | { id?: string; usage?: { input_tokens?: number } }
          | undefined;
        if (message?.id) this.id = message.id;
        if (message?.usage?.input_tokens) {
          this.usage.prompt_tokens = message.usage.input_tokens;
        }
        break;
      }

      case "content_block_start": {
        const index = Number(parsed.index ?? 0);
        const block = parsed.content_block as
          | { type?: string; id?: string; name?: string }
          | undefined;
        if (block?.type === "tool_use") {
          const toolIndex = this.nextToolIndex++;
          this.toolIndexByBlock.set(index, toolIndex);
          out.push(
            this.chunk({
              ...(this.roleSent ? {} : { role: "assistant" as const }),
              tool_calls: [
                {
                  index: toolIndex,
                  id: block.id ?? "",
                  type: "function",
                  function: { name: block.name ?? "", arguments: "" },
                },
              ],
            }),
          );
          this.roleSent = true;
        }
        break;
      }

      case "content_block_delta": {
        const index = Number(parsed.index ?? 0);
        const delta = parsed.delta as
          | { type?: string; text?: string; partial_json?: string }
          | undefined;
        if (delta?.type === "text_delta" && delta.text) {
          out.push(
            this.chunk({
              ...(this.roleSent ? {} : { role: "assistant" as const }),
              content: delta.text,
            }),
          );
          this.roleSent = true;
        } else if (delta?.type === "input_json_delta") {
          const toolIndex = this.toolIndexByBlock.get(index);
          if (toolIndex !== undefined && delta.partial_json) {
            out.push(
              this.chunk({
                tool_calls: [
                  {
                    index: toolIndex,
                    function: { arguments: delta.partial_json },
                  },
                ],
              }),
            );
          }
        }
        break;
      }

      case "message_delta": {
        const delta = parsed.delta as { stop_reason?: AnthropicStopReason } | undefined;
        if (delta?.stop_reason !== undefined) {
          this.finishReason = stopReasonToFinishReason(delta.stop_reason);
        }
        const usage = parsed.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens !== undefined) {
          this.usage.completion_tokens = usage.output_tokens;
        }
        break;
      }

      case "message_stop": {
        this.usage.total_tokens =
          this.usage.prompt_tokens + this.usage.completion_tokens;
        out.push(this.chunk({}, this.finishReason ?? "stop"));
        if (this.includeUsage) {
          out.push({
            id: this.id,
            object: "chat.completion.chunk",
            created: this.created,
            model: this.model,
            choices: [],
            usage: { ...this.usage },
          });
        }
        break;
      }

      case "error": {
        // Surfacing the upstream error mid-stream is better than a silent
        // truncation; the caller turns this into a terminating chunk.
        this.finishReason = "stop";
        break;
      }

      default:
        // ping, content_block_stop and anything new: nothing to emit.
        break;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Stream translation: OpenAI chunks -> Anthropic SSE
// ---------------------------------------------------------------------------

export interface AnthropicSSEFrame {
  event: string;
  data: string;
}

interface ToolStreamState {
  blockIndex: number;
  started: boolean;
}

/**
 * Stateful translator from OpenAI chat chunks to Anthropic streaming events,
 * used when a client calls `/v1/messages` but the chosen provider speaks the
 * OpenAI dialect.
 *
 * Anthropic's protocol is block-structured: each text run or tool call is a
 * content block that must be opened and closed, and the whole message is
 * wrapped in message_start / message_delta / message_stop.
 */
export class OpenAIToAnthropicStream {
  private id = messageId();
  private started = false;
  private textBlockOpen = false;
  private nextBlockIndex = 0;
  private toolStates = new Map<number, ToolStreamState>();
  private usage = { input_tokens: 0, output_tokens: 0 };
  private stopReason: AnthropicStopReason = null;
  private finished = false;

  constructor(private readonly model: string) {}

  private frame(event: string, payload: Record<string, unknown>): AnthropicSSEFrame {
    return { event, data: JSON.stringify({ type: event, ...payload }) };
  }

  private ensureStarted(out: AnthropicSSEFrame[]): void {
    if (this.started) return;
    this.started = true;
    out.push(
      this.frame("message_start", {
        message: {
          id: this.id,
          type: "message",
          role: "assistant",
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.usage.input_tokens, output_tokens: 0 },
        },
      }),
    );
  }

  private closeTextBlock(out: AnthropicSSEFrame[]): void {
    if (!this.textBlockOpen) return;
    this.textBlockOpen = false;
    out.push(this.frame("content_block_stop", { index: 0 }));
  }

  push(chunk: OpenAIChatChunk): AnthropicSSEFrame[] {
    const out: AnthropicSSEFrame[] = [];
    if (this.finished) return out;
    this.ensureStarted(out);

    if (chunk.usage) {
      this.usage.input_tokens = chunk.usage.prompt_tokens ?? this.usage.input_tokens;
      this.usage.output_tokens =
        chunk.usage.completion_tokens ?? this.usage.output_tokens;
    }

    const choice = chunk.choices?.[0];
    if (!choice) return out;

    const content = choice.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      if (!this.textBlockOpen) {
        this.textBlockOpen = true;
        // Text always occupies block 0 so tool blocks can follow it.
        this.nextBlockIndex = Math.max(this.nextBlockIndex, 1);
        out.push(
          this.frame("content_block_start", {
            index: 0,
            content_block: { type: "text", text: "" },
          }),
        );
      }
      out.push(
        this.frame("content_block_delta", {
          index: 0,
          delta: { type: "text_delta", text: content },
        }),
      );
    }

    for (const call of choice.delta?.tool_calls ?? []) {
      const key = call.index ?? 0;
      let state = this.toolStates.get(key);
      if (!state) {
        state = { blockIndex: this.nextBlockIndex++, started: false };
        this.toolStates.set(key, state);
      }
      if (!state.started && (call.id || call.function?.name)) {
        state.started = true;
        out.push(
          this.frame("content_block_start", {
            index: state.blockIndex,
            content_block: {
              type: "tool_use",
              id: call.id ?? `call_${state.blockIndex}`,
              name: call.function?.name ?? "",
              input: {},
            },
          }),
        );
      }
      if (call.function?.arguments) {
        out.push(
          this.frame("content_block_delta", {
            index: state.blockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: call.function.arguments,
            },
          }),
        );
      }
    }

    if (choice.finish_reason) {
      this.stopReason = finishReasonToStopReason(choice.finish_reason);
    }
    return out;
  }

  /** Emit the closing frames. Safe to call once; later calls return nothing. */
  finish(): AnthropicSSEFrame[] {
    const out: AnthropicSSEFrame[] = [];
    if (this.finished) return out;
    this.ensureStarted(out);
    this.closeTextBlock(out);
    for (const state of this.toolStates.values()) {
      if (state.started) {
        out.push(this.frame("content_block_stop", { index: state.blockIndex }));
      }
    }
    out.push(
      this.frame("message_delta", {
        delta: { stop_reason: this.stopReason ?? "end_turn", stop_sequence: null },
        usage: { output_tokens: this.usage.output_tokens },
      }),
    );
    out.push(this.frame("message_stop", {}));
    this.finished = true;
    return out;
  }
}
