import type { SSEEvent } from "./types";

// ─── SSE encoder ─────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

export function encodeSSE(event: SSEEvent): Uint8Array {
  const payload = JSON.stringify(event);
  return encoder.encode(`data: ${payload}\n\n`);
}

export function encodeDone(): Uint8Array {
  return encoder.encode("data: [DONE]\n\n");
}

// ─── Streaming response builder ───────────────────────────────────────────────

export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "X-Accel-Buffering": "no", // disable nginx buffering on proxied deployments
  };
}

// ─── Transform stream helper ─────────────────────────────────────────────────
// Wraps a generator of SSEEvents into a ReadableStream<Uint8Array>

export function eventsToStream(
  gen: AsyncGenerator<SSEEvent>
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of gen) {
          controller.enqueue(encodeSSE(event));
        }
        controller.enqueue(encodeDone());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encodeSSE({ type: "error", data: msg })
        );
        controller.enqueue(encodeDone());
      } finally {
        controller.close();
      }
    },
  });
}

// ─── K2 stream reader ─────────────────────────────────────────────────────────
// Reads an OpenAI-compatible SSE stream from K2 and yields string tokens.

export async function* readK2Stream(
  response: Response
): AsyncGenerator<string> {
  if (!response.body) throw new Error("K2 response has no body");

  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += dec.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") return;
      try {
        const chunk = JSON.parse(raw);
        const delta = chunk?.choices?.[0]?.delta;
        if (delta?.content) yield delta.content as string;
      } catch {
        // skip malformed chunks
      }
    }
  }
}
