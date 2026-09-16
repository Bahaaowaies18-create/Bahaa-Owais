import { describe, expect, it } from "vitest";
import type { AnthropicRequest, AnthropicResponse } from "../src/translate/anthropic-types.js";
import type { OpenAIChatChunk, OpenAIChatRequest } from "../src/translate/openai-types.js";
import {
  anthropicRequestToOpenAI,
  DEFAULT_MAX_TOKENS,
  openAIRequestToAnthropic,
} from "../src/translate/request.js";
import {
  AnthropicToOpenAIStream,
  anthropicResponseToOpenAI,
  OpenAIToAnthropicStream,
  openAIResponseToAnthropic,
} from "../src/translate/response.js";
import { anthropicStreamFrames } from "./helpers/mockUpstream.js";

describe("OpenAI request -> Anthropic request", () => {
  it("hoists system messages into the system field", () => {
    const out = openAIRequestToAnthropic(
      {
        model: "ignored",
        messages: [
          { role: "system", content: "Be terse." },
          { role: "system", content: "Answer in English." },
          { role: "user", content: "Hi" },
        ],
      },
      "claude-x",
    );
    expect(out.system).toBe("Be terse.\n\nAnswer in English.");
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toMatchObject({ role: "user" });
  });

  it("supplies a max_tokens default because Anthropic requires one", () => {
    const out = openAIRequestToAnthropic(
      { model: "m", messages: [{ role: "user", content: "Hi" }] },
      "claude-x",
    );
    expect(out.max_tokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("prefers max_completion_tokens when both are present", () => {
    const out = openAIRequestToAnthropic(
      {
        model: "m",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 100,
        max_completion_tokens: 250,
      },
      "claude-x",
    );
    expect(out.max_tokens).toBe(250);
  });

  it("converts assistant tool calls into tool_use blocks", () => {
    const out = openAIRequestToAnthropic(
      {
        model: "m",
        messages: [
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Amman"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "31C" },
        ],
      },
      "claude-x",
    );
    expect(out.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Amman" } },
      ],
    });
    expect(out.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1", content: "31C" }],
    });
  });

  it("merges consecutive tool results into one user turn", () => {
    const out = openAIRequestToAnthropic(
      {
        model: "m",
        messages: [
          { role: "user", content: "go" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "a", type: "function", function: { name: "f", arguments: "{}" } },
              { id: "b", type: "function", function: { name: "g", arguments: "{}" } },
            ],
          },
          { role: "tool", tool_call_id: "a", content: "1" },
          { role: "tool", tool_call_id: "b", content: "2" },
        ],
      },
      "claude-x",
    );
    const last = out.messages[out.messages.length - 1]!;
    expect(last.role).toBe("user");
    expect(Array.isArray(last.content) ? last.content : []).toHaveLength(2);
  });

  it("maps tool_choice and stop sequences", () => {
    const out = openAIRequestToAnthropic(
      {
        model: "m",
        messages: [{ role: "user", content: "x" }],
        stop: "END",
        tool_choice: "required",
        tools: [
          {
            type: "function",
            function: {
              name: "f",
              description: "does f",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      },
      "claude-x",
    );
    expect(out.stop_sequences).toEqual(["END"]);
    expect(out.tool_choice).toEqual({ type: "any" });
    expect(out.tools).toEqual([
      { name: "f", description: "does f", input_schema: { type: "object", properties: {} } },
    ]);
  });

  it("converts a data-url image into a base64 image block", () => {
    const out = openAIRequestToAnthropic(
      {
        model: "m",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "what is this" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,AAAA" },
              },
            ],
          },
        ],
      },
      "claude-x",
    );
    expect(out.messages[0]!.content).toEqual([
      { type: "text", text: "what is this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("drops assistant turns that would be empty", () => {
    const out = openAIRequestToAnthropic(
      {
        model: "m",
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "" },
          { role: "user", content: "still there?" },
        ],
      },
      "claude-x",
    );
    expect(out.messages.every((m) => m.content.length > 0)).toBe(true);
    expect(out.messages.map((m) => m.role)).toEqual(["user", "user"]);
  });
});

describe("Anthropic request -> OpenAI request", () => {
  it("turns the system field back into a system message", () => {
    const req: AnthropicRequest = {
      model: "claude-x",
      max_tokens: 64,
      system: "Be terse.",
      messages: [{ role: "user", content: "Hi" }],
    };
    const out = anthropicRequestToOpenAI(req);
    expect(out.messages[0]).toEqual({ role: "system", content: "Be terse." });
    expect(out.messages[1]).toEqual({ role: "user", content: "Hi" });
    expect(out.max_tokens).toBe(64);
  });

  it("splits tool_result blocks into tool messages", () => {
    const req: AnthropicRequest = {
      model: "claude-x",
      max_tokens: 64,
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "checking" },
            { type: "tool_use", id: "t1", name: "get_weather", input: { city: "Amman" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "31C" }],
        },
      ],
    };
    const out = anthropicRequestToOpenAI(req);
    expect(out.messages[1]).toMatchObject({
      role: "assistant",
      content: "checking",
      tool_calls: [
        { id: "t1", type: "function", function: { name: "get_weather" } },
      ],
    });
    expect(out.messages[2]).toEqual({
      role: "tool",
      tool_call_id: "t1",
      content: "31C",
    });
  });

  it("round-trips a conversation through both directions", () => {
    const original: OpenAIChatRequest = {
      model: "m",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
        { role: "user", content: "bye" },
      ],
      max_tokens: 128,
    };
    const roundTripped = anthropicRequestToOpenAI(
      openAIRequestToAnthropic(original, "claude-x"),
    );
    expect(roundTripped.messages).toEqual(original.messages);
    expect(roundTripped.max_tokens).toBe(128);
  });
});

describe("response translation", () => {
  const anthropicRes: AnthropicResponse = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-x",
    content: [
      { type: "text", text: "Hello" },
      { type: "tool_use", id: "t1", name: "f", input: { a: 1 } },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 7, output_tokens: 3 },
  };

  it("maps an Anthropic response to the OpenAI shape", () => {
    const out = anthropicResponseToOpenAI(anthropicRes, "requested-model");
    expect(out.model).toBe("requested-model");
    expect(out.choices[0]!.message.content).toBe("Hello");
    expect(out.choices[0]!.message.tool_calls).toEqual([
      { id: "t1", type: "function", function: { name: "f", arguments: '{"a":1}' } },
    ]);
    expect(out.choices[0]!.finish_reason).toBe("tool_calls");
    expect(out.usage).toEqual({
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
    });
  });

  it("maps stop reasons in both directions", () => {
    const back = openAIResponseToAnthropic(
      anthropicResponseToOpenAI(anthropicRes, "m"),
      "m",
    );
    expect(back.stop_reason).toBe("tool_use");
    expect(back.content).toEqual(anthropicRes.content);
    expect(back.usage).toEqual({ input_tokens: 7, output_tokens: 3 });
  });

  it("represents an empty completion as null content", () => {
    const out = anthropicResponseToOpenAI(
      { ...anthropicRes, content: [], stop_reason: "end_turn" },
      "m",
    );
    expect(out.choices[0]!.message.content).toBeNull();
    expect(out.choices[0]!.finish_reason).toBe("stop");
  });
});

describe("Anthropic SSE -> OpenAI chunks", () => {
  it("translates a text stream, ending with a finish_reason chunk", () => {
    const translator = new AnthropicToOpenAIStream("my-model", true);
    const chunks: OpenAIChatChunk[] = [];
    for (const frame of anthropicStreamFrames(["Hel", "lo"])) {
      chunks.push(...translator.push(frame));
    }

    const text = chunks
      .map((c) => c.choices[0]?.delta?.content ?? "")
      .join("");
    expect(text).toBe("Hello");
    expect(chunks[0]!.choices[0]!.delta.role).toBe("assistant");

    const finish = chunks.find((c) => c.choices[0]?.finish_reason);
    expect(finish!.choices[0]!.finish_reason).toBe("stop");

    const usage = chunks.find((c) => c.usage);
    expect(usage!.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 2,
      total_tokens: 14,
    });
  });

  it("omits the usage chunk when include_usage is off", () => {
    const translator = new AnthropicToOpenAIStream("my-model", false);
    const chunks: OpenAIChatChunk[] = [];
    for (const frame of anthropicStreamFrames(["hi"])) {
      chunks.push(...translator.push(frame));
    }
    expect(chunks.some((c) => c.usage)).toBe(false);
  });

  it("translates streamed tool calls into tool_call deltas", () => {
    const translator = new AnthropicToOpenAIStream("my-model", false);
    const frames = [
      {
        data: JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "t1", name: "get_weather" },
        }),
      },
      {
        data: JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"ci' },
        }),
      },
      {
        data: JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: 'ty":"Amman"}' },
        }),
      },
      {
        data: JSON.stringify({
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
        }),
      },
      { data: JSON.stringify({ type: "message_stop" }) },
    ];
    const chunks = frames.flatMap((f) => translator.push(f));

    const args = chunks
      .flatMap((c) => c.choices[0]?.delta?.tool_calls ?? [])
      .map((t) => t.function?.arguments ?? "")
      .join("");
    expect(args).toBe('{"city":"Amman"}');
    expect(chunks.at(-1)!.choices[0]!.finish_reason).toBe("tool_calls");
  });

  it("ignores frames it cannot parse", () => {
    const translator = new AnthropicToOpenAIStream("m", false);
    expect(translator.push({ data: "not json" })).toEqual([]);
    expect(translator.push({ data: JSON.stringify({ type: "ping" }) })).toEqual([]);
  });
});

describe("OpenAI chunks -> Anthropic SSE", () => {
  function chunk(delta: Record<string, unknown>, finish?: string): OpenAIChatChunk {
    return {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          delta: delta as OpenAIChatChunk["choices"][number]["delta"],
          ...(finish ? { finish_reason: finish as "stop" } : {}),
        },
      ],
    };
  }

  it("emits a well-formed block-structured stream", () => {
    const translator = new OpenAIToAnthropicStream("claude-x");
    const frames = [
      ...translator.push(chunk({ role: "assistant", content: "Hel" })),
      ...translator.push(chunk({ content: "lo" })),
      ...translator.push(chunk({}, "stop")),
      ...translator.finish(),
    ];
    const events = frames.map((f) => f.event);
    expect(events).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);

    const text = frames
      .filter((f) => f.event === "content_block_delta")
      .map((f) => JSON.parse(f.data).delta.text)
      .join("");
    expect(text).toBe("Hello");

    const messageDelta = JSON.parse(
      frames.find((f) => f.event === "message_delta")!.data,
    );
    expect(messageDelta.delta.stop_reason).toBe("end_turn");
  });

  it("opens a separate content block per tool call", () => {
    const translator = new OpenAIToAnthropicStream("claude-x");
    const frames = [
      ...translator.push(chunk({ content: "thinking" })),
      ...translator.push(
        chunk({
          tool_calls: [
            { index: 0, id: "t1", type: "function", function: { name: "f", arguments: "" } },
          ],
        }),
      ),
      ...translator.push(
        chunk({ tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] }),
      ),
      ...translator.push(chunk({}, "tool_calls")),
      ...translator.finish(),
    ];

    const starts = frames
      .filter((f) => f.event === "content_block_start")
      .map((f) => JSON.parse(f.data));
    expect(starts).toHaveLength(2);
    expect(starts[0].content_block.type).toBe("text");
    expect(starts[1]).toMatchObject({
      index: 1,
      content_block: { type: "tool_use", id: "t1", name: "f" },
    });

    const stop = JSON.parse(frames.find((f) => f.event === "message_delta")!.data);
    expect(stop.delta.stop_reason).toBe("tool_use");
  });

  it("still closes the message when no content arrived", () => {
    const translator = new OpenAIToAnthropicStream("claude-x");
    const frames = translator.finish();
    expect(frames.map((f) => f.event)).toEqual([
      "message_start",
      "message_delta",
      "message_stop",
    ]);
    expect(translator.finish()).toEqual([]);
  });

  it("reports usage from the trailing usage chunk", () => {
    const translator = new OpenAIToAnthropicStream("claude-x");
    translator.push(chunk({ content: "hi" }));
    translator.push({
      id: "c",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [],
      usage: { prompt_tokens: 4, completion_tokens: 9, total_tokens: 13 },
    });
    const frames = translator.finish();
    const delta = JSON.parse(frames.find((f) => f.event === "message_delta")!.data);
    expect(delta.usage.output_tokens).toBe(9);
  });
});
