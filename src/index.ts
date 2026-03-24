import type { Env, SSEEvent } from "./types";
import { eventsToStream, sseHeaders } from "./stream";
import { runOrchestrator } from "./orchestrator";
import { getOrCreateSession, addMessage, getHistory } from "./memory";

// ─── CORS preflight ───────────────────────────────────────────────────────────

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-Id",
    "Access-Control-Max-Age": "86400",
  };
}

function options(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function notFound(): Response {
  return json({ error: "Not found" }, 404);
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400);
}

// ─── Route: POST /v1/swarm ────────────────────────────────────────────────────
// Main endpoint — accepts a user message, streams back SSE events.
//
// Request body:
//   { "message": "...", "session_id": "optional-uuid" }
//
// Response: text/event-stream (SSE)
//   Each event: data: {"type":"...", "agent":"...", "data":"...", "taskId":"..."}
//   Final event: data: [DONE]

async function handleSwarm(req: Request, env: Env): Promise<Response> {
  let body: { message?: string; session_id?: string };
  try {
    body = (await req.json()) as { message?: string; session_id?: string };
  } catch {
    return badRequest("Request body must be valid JSON");
  }

  const { message, session_id } = body;
  if (!message?.trim()) {
    return badRequest('Field "message" is required and must be non-empty');
  }

  const sessionId = session_id ?? crypto.randomUUID();
  const history = getHistory(sessionId);

  // Persist the user message
  addMessage(sessionId, { role: "user", content: message });

  // Build the SSE generator
  async function* generate(): AsyncGenerator<SSEEvent> {
    // Emit session id so the client can resume the session
    yield {
      type: "agent_start" as const,
      agent: "orchestrator" as const,
      data: JSON.stringify({ session_id: sessionId }),
    };

    let finalAnswer = "";
    for await (const event of runOrchestrator(env, message, history)) {
      yield event;
      if (event.type === "final_response") {
        finalAnswer = event.data;
      }
    }

    // Persist the assistant's final response
    if (finalAnswer) {
      addMessage(sessionId, { role: "assistant", content: finalAnswer });
    }
  }

  return new Response(eventsToStream(generate()), {
    headers: { ...sseHeaders(), "X-Session-Id": sessionId },
  });
}

// ─── Route: POST /v1/chat ─────────────────────────────────────────────────────
// Simple single-turn chat — bypasses the orchestrator, calls K2 directly.
// Useful for testing the API connection.

async function handleChat(req: Request, env: Env): Promise<Response> {
  let body: { message?: string };
  try {
    body = (await req.json()) as { message?: string };
  } catch {
    return badRequest("Request body must be valid JSON");
  }

  if (!body.message?.trim()) {
    return badRequest('Field "message" is required');
  }

  const k2Res = await fetch(`${env.K2_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.K2_API_KEY}`,
    },
    body: JSON.stringify({
      model: "MBZUAI-IFM/K2-Think-v2",
      messages: [{ role: "user", content: body.message }],
      stream: false,
      max_tokens: 1024,
    }),
  });

  if (!k2Res.ok) {
    const err = await k2Res.text();
    return json({ error: `K2 API error: ${err}` }, k2Res.status);
  }

  const data = await k2Res.json();
  return json(data);
}

// ─── Route: GET /health ───────────────────────────────────────────────────────

function handleHealth(): Response {
  return json({
    status: "ok",
    service: "k2-swarm",
    model: "MBZUAI-IFM/K2-Think-v2",
    agents: ["orchestrator", "researcher", "coder", "writer", "critic", "summarizer", "planner", "formatter"],
    timestamp: new Date().toISOString(),
  });
}

// ─── Route: GET /v1/agents ────────────────────────────────────────────────────

function handleAgentList(): Response {
  return json({
    agents: [
      { name: "orchestrator", description: "Plans and coordinates all sub-agents" },
      { name: "researcher",   description: "Web search and URL reading" },
      { name: "coder",        description: "Code writing, debugging, and execution" },
      { name: "writer",       description: "Long-form content generation" },
      { name: "critic",       description: "Review and improvement of outputs" },
      { name: "summarizer",   description: "Condenses content into shorter form" },
      { name: "planner",      description: "Breaks goals into ordered steps" },
      { name: "formatter",    description: "Converts output to JSON, markdown, etc." },
    ],
    tools: ["web_search", "code_exec", "read_url", "summarize", "format_output"],
  });
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === "OPTIONS") return options();

    // Validate API key is configured
    if (!env.K2_API_KEY) {
      return json(
        { error: "K2_API_KEY is not configured. Set it in wrangler.toml or Worker secrets." },
        500
      );
    }

    const route = `${method} ${url.pathname}`;

    switch (route) {
      case "GET /health":
        return handleHealth();

      case "GET /v1/agents":
        return handleAgentList();

      case "POST /v1/swarm":
        return handleSwarm(request, env);

      case "POST /v1/chat":
        return handleChat(request, env);

      default:
        return notFound();
    }
  },
} satisfies ExportedHandler<Env>;
