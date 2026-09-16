/**
 * The OpenAI chat-completions shapes the gateway uses as its canonical
 * internal format. Only the fields the gateway inspects are typed precisely;
 * everything else rides along untouched via the index signature so provider
 * extensions are not dropped in transit.
 */

export interface OpenAITextPart {
  type: "text";
  text: string;
}

export interface OpenAIImagePart {
  type: "image_url";
  image_url: { url: string; detail?: string };
}

export type OpenAIContentPart =
  | OpenAITextPart
  | OpenAIImagePart
  | { type: string; [k: string]: unknown };

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  [k: string]: unknown;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type OpenAIToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  parallel_tool_calls?: boolean;
  user?: string;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  [k: string]: unknown;
}

export type OpenAIFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | null;

export interface OpenAIChatChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
    [k: string]: unknown;
  };
  finish_reason: OpenAIFinishReason;
  [k: string]: unknown;
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatChoice[];
  usage?: OpenAIUsage;
  [k: string]: unknown;
}

export interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface OpenAIChatChunkChoice {
  index: number;
  delta: {
    role?: "assistant";
    content?: string | null;
    tool_calls?: OpenAIToolCallDelta[];
    [k: string]: unknown;
  };
  finish_reason?: OpenAIFinishReason;
  [k: string]: unknown;
}

export interface OpenAIChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OpenAIChatChunkChoice[];
  usage?: OpenAIUsage | null;
  [k: string]: unknown;
}

export interface OpenAIModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  [k: string]: unknown;
}

/** Flatten OpenAI content (string or parts) to plain text. */
export function contentToText(
  content: string | OpenAIContentPart[] | null | undefined,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is OpenAITextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}
