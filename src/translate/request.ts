import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicTextBlock,
  AnthropicTool,
  AnthropicToolChoice,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
} from "./anthropic-types.js";
import {
  contentToText,
  type OpenAIChatRequest,
  type OpenAIContentPart,
  type OpenAIMessage,
  type OpenAITool,
  type OpenAIToolCall,
  type OpenAIToolChoice,
} from "./openai-types.js";

/** Anthropic requires max_tokens; OpenAI does not. Used when none is given. */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * Fields the gateway consumes or rewrites and must not forward verbatim to an
 * upstream that speaks a different dialect.
 */
const OPENAI_HANDLED_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "stop",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "user",
  "n",
  "metadata",
  "frequency_penalty",
  "presence_penalty",
  "logit_bias",
  "logprobs",
  "top_logprobs",
  "response_format",
  "seed",
]);

const ANTHROPIC_HANDLED_KEYS = new Set([
  "model",
  "messages",
  "system",
  "max_tokens",
  "stream",
  "temperature",
  "top_p",
  "top_k",
  "stop_sequences",
  "tools",
  "tool_choice",
  "metadata",
]);

// ---------------------------------------------------------------------------
// OpenAI request -> Anthropic request
// ---------------------------------------------------------------------------

function openAIPartsToAnthropic(
  content: string | OpenAIContentPart[] | null | undefined,
): AnthropicContentBlock[] {
  if (content == null) return [];
  if (typeof content === "string") {
    return content === "" ? [] : [{ type: "text", text: content }];
  }
  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: String((part as { text: string }).text) });
    } else if (part.type === "image_url") {
      const url = (part as { image_url?: { url?: string } }).image_url?.url ?? "";
      const dataUrl = /^data:([^;]+);base64,(.*)$/s.exec(url);
      if (dataUrl) {
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: dataUrl[1] as string,
            data: dataUrl[2] as string,
          },
        });
      } else if (url) {
        blocks.push({ type: "image", source: { type: "url", url } });
      }
    } else {
      // Unknown part types are forwarded as-is; Anthropic rejects what it
      // cannot handle, which is more useful than silently dropping content.
      blocks.push(part as AnthropicContentBlock);
    }
  }
  return blocks;
}

function toolCallsToBlocks(calls: OpenAIToolCall[]): AnthropicToolUseBlock[] {
  return calls.map((call) => {
    let input: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(call.function.arguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>;
      }
    } catch {
      // A model that emitted invalid JSON still gets its text through, rather
      // than failing the whole request at the gateway.
      input = { _raw: call.function.arguments };
    }
    return { type: "tool_use", id: call.id, name: call.function.name, input };
  });
}

function openAIToolsToAnthropic(tools: OpenAITool[]): AnthropicTool[] {
  return tools
    .filter((t) => t.type === "function" && t.function?.name)
    .map((t) => ({
      name: t.function.name,
      ...(t.function.description ? { description: t.function.description } : {}),
      input_schema: t.function.parameters ?? {
        type: "object",
        properties: {},
      },
    }));
}

function openAIToolChoiceToAnthropic(
  choice: OpenAIToolChoice | undefined,
): AnthropicToolChoice | undefined {
  if (choice === undefined) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "none" };
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

/**
 * Convert a canonical (OpenAI) chat request into an Anthropic Messages
 * request. `model` is the upstream model id, which may differ from the one the
 * client asked for.
 */
export function openAIRequestToAnthropic(
  req: OpenAIChatRequest,
  model: string,
): AnthropicRequest {
  const systemParts: string[] = [];
  const messages: AnthropicMessage[] = [];

  for (const msg of req.messages) {
    if (msg.role === "system" || msg.role === "developer") {
      const text = contentToText(msg.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (msg.role === "tool") {
      const block: AnthropicToolResultBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: contentToText(msg.content),
      };
      // Consecutive tool results belong in one user turn, which is what the
      // Anthropic API expects after a multi-tool assistant turn.
      const last = messages[messages.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        messages.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: AnthropicContentBlock[] = openAIPartsToAnthropic(msg.content);
      if (msg.tool_calls?.length) blocks.push(...toolCallsToBlocks(msg.tool_calls));
      // Anthropic rejects empty assistant content.
      if (blocks.length === 0) continue;
      messages.push({ role: "assistant", content: blocks });
      continue;
    }

    const blocks = openAIPartsToAnthropic(msg.content);
    messages.push({
      role: "user",
      content: blocks.length ? blocks : [{ type: "text", text: "" }],
    });
  }

  const out: AnthropicRequest = {
    model,
    messages,
    max_tokens:
      req.max_completion_tokens ?? req.max_tokens ?? DEFAULT_MAX_TOKENS,
  };

  if (systemParts.length) out.system = systemParts.join("\n\n");
  if (req.stream !== undefined) out.stream = req.stream;
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.stop !== undefined) {
    out.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  }
  if (req.tools?.length) out.tools = openAIToolsToAnthropic(req.tools);
  const toolChoice = openAIToolChoiceToAnthropic(req.tool_choice);
  if (toolChoice) out.tool_choice = toolChoice;
  if (req.user) out.metadata = { user_id: req.user };

  // Forward provider-specific extras the client set deliberately.
  for (const [key, value] of Object.entries(req)) {
    if (!OPENAI_HANDLED_KEYS.has(key) && !(key in out)) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anthropic request -> OpenAI request (inbound /v1/messages)
// ---------------------------------------------------------------------------

function anthropicSystemToText(
  system: string | AnthropicTextBlock[] | undefined,
): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

function anthropicToolResultText(
  content: AnthropicToolResultBlock["content"],
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function anthropicBlocksToOpenAIParts(
  blocks: AnthropicContentBlock[],
): string | OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      parts.push({ type: "text", text: (block as AnthropicTextBlock).text });
    } else if (block.type === "image") {
      const source = (block as { source?: Record<string, string> }).source;
      if (source?.type === "base64") {
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${source.media_type};base64,${source.data}`,
          },
        });
      } else if (source?.type === "url" && source.url) {
        parts.push({ type: "image_url", image_url: { url: source.url } });
      }
    }
  }
  // Collapse a lone text part back to a plain string: the shape most
  // OpenAI-compatible providers handle best.
  if (parts.length === 1 && parts[0]?.type === "text") {
    return (parts[0] as { text: string }).text;
  }
  return parts;
}

/** Convert an inbound Anthropic Messages request to the canonical format. */
export function anthropicRequestToOpenAI(
  req: AnthropicRequest,
): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [];
  const system = anthropicSystemToText(req.system);
  if (system) messages.push({ role: "system", content: system });

  for (const msg of req.messages) {
    const blocks: AnthropicContentBlock[] =
      typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : msg.content;

    if (msg.role === "assistant") {
      const toolUses = blocks.filter(
        (b): b is AnthropicToolUseBlock => b.type === "tool_use",
      );
      const rest = blocks.filter((b) => b.type !== "tool_use");
      const entry: OpenAIMessage = {
        role: "assistant",
        content: rest.length ? anthropicBlocksToOpenAIParts(rest) : null,
      };
      if (toolUses.length) {
        entry.tool_calls = toolUses.map((b) => ({
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      }
      messages.push(entry);
      continue;
    }

    // A user turn may mix tool results with ordinary content. Tool results
    // become their own `tool` messages, which is how OpenAI represents them.
    const toolResults = blocks.filter(
      (b): b is AnthropicToolResultBlock => b.type === "tool_result",
    );
    const rest = blocks.filter((b) => b.type !== "tool_result");
    for (const result of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: result.tool_use_id,
        content: anthropicToolResultText(result.content),
      });
    }
    if (rest.length) {
      messages.push({ role: "user", content: anthropicBlocksToOpenAIParts(rest) });
    }
  }

  const out: OpenAIChatRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
  };
  if (req.stream !== undefined) out.stream = req.stream;
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.stop_sequences?.length) out.stop = req.stop_sequences;
  if (req.tools?.length) {
    out.tools = req.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.input_schema ?? { type: "object", properties: {} },
      },
    }));
  }
  if (req.tool_choice) {
    const tc = req.tool_choice;
    out.tool_choice =
      tc.type === "any"
        ? "required"
        : tc.type === "tool"
          ? { type: "function", function: { name: tc.name } }
          : tc.type === "none"
            ? "none"
            : "auto";
  }
  if (req.metadata?.user_id) out.user = String(req.metadata.user_id);

  for (const [key, value] of Object.entries(req)) {
    if (!ANTHROPIC_HANDLED_KEYS.has(key) && !(key in out)) out[key] = value;
  }
  return out;
}
