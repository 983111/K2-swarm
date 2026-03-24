import type {
  Message,
  ToolDefinition,
  ToolCall,
  K2Request,
  K2Response,
  Env,
} from "./types";
import { readK2Stream } from "./stream";
import { executeTool } from "./tools/executor";

const MODEL = "MBZUAI-IFM/K2-Think-v2";
const MAX_TOOL_ROUNDS = 8; // prevent infinite tool loops

// ─── Non-streaming completion (returns full text) ─────────────────────────────

export async function complete(
  env: Env,
  messages: Message[],
  options?: {
    tools?: ToolDefinition[];
    temperature?: number;
    max_tokens?: number;
  }
): Promise<{ content: string; toolsUsed: string[] }> {
  const toolsUsed: string[] = [];
  let msgs = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const req: K2Request = {
      model: MODEL,
      messages: msgs,
      tools: options?.tools,
      tool_choice: options?.tools?.length ? "auto" : undefined,
      stream: false,
      max_tokens: options?.max_tokens ?? 2048,
      temperature: options?.temperature ?? 0.7,
    };

    const res = await fetch(`${env.K2_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.K2_API_KEY}`,
      },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`K2 API error ${res.status}: ${err}`);
    }

    const data = (await res.json()) as K2Response;
    const choice = data.choices[0];

    // No tool calls — we're done
    if (
      choice.finish_reason === "stop" ||
      !choice.message.tool_calls?.length
    ) {
      return { content: choice.message.content ?? "", toolsUsed };
    }

    // Execute tool calls
    const toolCalls = choice.message.tool_calls!;
    msgs.push({
      role: "assistant",
      content: choice.message.content ?? "",
    });

    for (const tc of toolCalls) {
      toolsUsed.push(tc.function.name);
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      const result = await executeTool({ name: tc.function.name, args });
      msgs.push({
        role: "tool",
        name: tc.function.name,
        tool_call_id: tc.id,
        content: result.error
          ? `Error: ${result.error}`
          : result.result,
      });
    }
  }

  return { content: "Max tool rounds reached.", toolsUsed };
}

// ─── Streaming completion (yields tokens + tool events) ───────────────────────

export async function* completeStream(
  env: Env,
  messages: Message[],
  options?: {
    tools?: ToolDefinition[];
    temperature?: number;
    max_tokens?: number;
  }
): AsyncGenerator<
  | { type: "token"; content: string }
  | { type: "tool_call"; name: string; args: string }
  | { type: "tool_result"; name: string; result: string }
  | { type: "done"; content: string }
> {
  let msgs = [...messages];
  let fullContent = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const req: K2Request = {
      model: MODEL,
      messages: msgs,
      tools: options?.tools,
      tool_choice: options?.tools?.length ? "auto" : undefined,
      stream: true,
      max_tokens: options?.max_tokens ?? 2048,
      temperature: options?.temperature ?? 0.7,
    };

    const res = await fetch(`${env.K2_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.K2_API_KEY}`,
      },
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`K2 API error ${res.status}: ${err}`);
    }

    // Collect streaming tokens
    let streamedContent = "";
    const pendingToolCalls: Map<number, { id: string; name: string; args: string }> =
      new Map();

    if (!res.body) throw new Error("No stream body");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let finishReason: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") { finishReason = finishReason ?? "stop"; continue; }
        try {
          const chunk = JSON.parse(raw);
          const delta = chunk?.choices?.[0]?.delta;
          const fr = chunk?.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;

          if (delta?.content) {
            streamedContent += delta.content;
            fullContent += delta.content;
            yield { type: "token", content: delta.content };
          }

          // Accumulate tool call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls as Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>) {
              const existing = pendingToolCalls.get(tc.index) ?? {
                id: "",
                name: "",
                args: "",
              };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
              pendingToolCalls.set(tc.index, existing);
            }
          }
        } catch {
          // skip
        }
      }
    }

    // No tool calls — final answer
    if (finishReason === "stop" || pendingToolCalls.size === 0) {
      yield { type: "done", content: fullContent };
      return;
    }

    // Execute tool calls
    msgs.push({ role: "assistant", content: streamedContent });

    for (const [, tc] of pendingToolCalls) {
      yield { type: "tool_call", name: tc.name, args: tc.args };

      let args: Record<string, string> = {};
      try { args = JSON.parse(tc.args); } catch { args = {}; }

      const result = await executeTool({ name: tc.name, args });
      const resultText = result.error
        ? `Error: ${result.error}`
        : result.result;

      yield { type: "tool_result", name: tc.name, result: resultText };

      msgs.push({
        role: "tool",
        name: tc.name,
        tool_call_id: tc.id,
        content: resultText,
      });
    }
  }

  yield { type: "done", content: fullContent };
}
