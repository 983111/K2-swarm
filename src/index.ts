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

function toEnvString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function resolveEnv(env?: Partial<Env>): Env {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const processEnv = maybeProcess?.env ?? {};
  const keyFromBinding = toEnvString((env as { K2_API_KEY?: unknown } | undefined)?.K2_API_KEY);
  const keyFromProcess = toEnvString(processEnv.K2_API_KEY);
  const baseUrlFromBinding = toEnvString((env as { K2_BASE_URL?: unknown } | undefined)?.K2_BASE_URL);
  const baseUrlFromProcess = toEnvString(processEnv.K2_BASE_URL);

  return {
    K2_API_KEY: keyFromBinding || keyFromProcess,
    K2_BASE_URL: baseUrlFromBinding || baseUrlFromProcess || "https://api.k2think.ai/v1",
  };
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

function handleHome(): Response {
  return html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>K2 Swarm Enterprise Console</title>
    <style>
      :root {
        --bg: #040a1a;
        --card: rgba(11, 24, 54, 0.8);
        --card-border: rgba(98, 127, 255, 0.3);
        --text: #f8faff;
        --muted: #9db0dc;
        --accent: #5a8cff;
        --accent-2: #48d9ff;
        --danger: #ff6b8f;
        --ok: #23d39a;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial;
        color: var(--text);
        background:
          radial-gradient(1200px 700px at 85% -20%, rgba(90, 140, 255, 0.28), transparent 70%),
          radial-gradient(1000px 700px at -10% 110%, rgba(72, 217, 255, 0.2), transparent 70%),
          linear-gradient(145deg, #020617 0%, #07102b 48%, #030918 100%);
        padding: 32px;
      }

      .shell {
        max-width: 1200px;
        margin: 0 auto;
        display: grid;
        grid-template-columns: 280px 1fr;
        gap: 20px;
      }

      .panel {
        backdrop-filter: blur(16px);
        background: var(--card);
        border: 1px solid var(--card-border);
        border-radius: 20px;
        box-shadow: 0 20px 80px rgba(0, 0, 0, 0.45);
      }

      .sidebar {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        position: sticky;
        top: 24px;
        height: fit-content;
      }

      .brand h1 {
        margin: 0;
        font-size: 1.18rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .brand p {
        margin: 4px 0 0 0;
        font-size: 0.82rem;
        color: var(--muted);
      }

      .metric {
        background: rgba(8, 17, 43, 0.6);
        border: 1px solid rgba(128, 151, 255, 0.22);
        border-radius: 14px;
        padding: 12px;
      }
      .metric .label { color: var(--muted); font-size: 0.76rem; }
      .metric .value { font-size: 0.96rem; margin-top: 4px; }
      .status-online { color: var(--ok); }

      .content {
        padding: 24px;
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 16px;
        min-height: calc(100vh - 64px);
      }

      .heading h2 { margin: 0; font-size: 1.5rem; }
      .heading p { margin: 8px 0 0 0; color: var(--muted); }

      .controls {
        display: grid;
        grid-template-columns: 170px 1fr 130px;
        gap: 10px;
      }

      select, textarea, button {
        font: inherit;
        border-radius: 12px;
        border: 1px solid rgba(141, 165, 255, 0.32);
        background: rgba(6, 16, 43, 0.9);
        color: var(--text);
      }
      select, button { padding: 11px 12px; }
      textarea {
        width: 100%;
        min-height: 96px;
        resize: vertical;
        padding: 12px;
      }
      button {
        cursor: pointer;
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
        border: none;
        color: #021026;
        font-weight: 700;
      }
      button:disabled { opacity: 0.55; cursor: not-allowed; }

      .stream-wrap {
        overflow: auto;
        border-radius: 14px;
        border: 1px solid rgba(132, 157, 255, 0.3);
        background: rgba(4, 12, 34, 0.82);
        padding: 14px;
      }

      .row {
        margin: 0 0 12px;
        padding: 10px 12px;
        border-radius: 10px;
        background: rgba(13, 24, 58, 0.7);
        border: 1px solid rgba(112, 141, 247, 0.26);
      }
      .row.user { border-left: 3px solid #48d9ff; }
      .row.system { border-left: 3px solid #93a6ff; }
      .row.final { border-left: 3px solid #23d39a; }
      .row.error { border-left: 3px solid var(--danger); }
      .row .meta { font-size: 0.75rem; color: var(--muted); margin-bottom: 4px; }
      .row pre {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.86rem;
        white-space: pre-wrap;
        word-break: break-word;
      }

      @media (max-width: 980px) {
        body { padding: 16px; }
        .shell { grid-template-columns: 1fr; }
        .sidebar { position: static; }
        .controls { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <aside class="panel sidebar">
        <div class="brand">
          <h1>K2 Swarm</h1>
          <p>Enterprise Orchestration Console</p>
        </div>
        <div class="metric">
          <div class="label">Environment</div>
          <div class="value">Cloudflare Workers</div>
        </div>
        <div class="metric">
          <div class="label">Model</div>
          <div class="value">MBZUAI-IFM/K2-Think-v2</div>
        </div>
        <div class="metric">
          <div class="label">API Status</div>
          <div id="api-status" class="value status-online">Checking…</div>
        </div>
        <div class="metric">
          <div class="label">Session ID</div>
          <div id="session-id" class="value">Not started</div>
        </div>
      </aside>

      <main class="panel content">
        <header class="heading">
          <h2>Agent Test Workbench</h2>
          <p>Send prompts to direct chat or full multi-agent swarm and inspect live execution events.</p>
        </header>

        <section class="controls">
          <select id="mode">
            <option value="swarm" selected>Swarm (SSE streaming)</option>
            <option value="chat">Direct Chat (single response)</option>
          </select>
          <textarea id="prompt" placeholder="Ask for enterprise plans, coding, analysis, or multi-step tasks..."></textarea>
          <button id="run-btn">Run</button>
        </section>

        <section id="stream" class="stream-wrap"></section>
      </main>
    </div>

    <script>
      const streamEl = document.getElementById("stream");
      const promptEl = document.getElementById("prompt");
      const modeEl = document.getElementById("mode");
      const runBtn = document.getElementById("run-btn");
      const sessionEl = document.getElementById("session-id");
      const statusEl = document.getElementById("api-status");
      let sessionId = localStorage.getItem("k2_session_id") || "";

      function addRow(kind, title, payload) {
        const row = document.createElement("article");
        row.className = "row " + kind;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = title + " • " + new Date().toLocaleTimeString();
        const pre = document.createElement("pre");
        pre.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
        row.append(meta, pre);
        streamEl.appendChild(row);
        streamEl.scrollTop = streamEl.scrollHeight;
      }

      async function checkHealth() {
        try {
          const res = await fetch("/health");
          statusEl.textContent = res.ok ? "Online" : "Unavailable";
          statusEl.className = "value " + (res.ok ? "status-online" : "");
        } catch {
          statusEl.textContent = "Unavailable";
          statusEl.className = "value";
        }
      }

      async function runChat(message) {
        const res = await fetch("/v1/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Chat request failed");
        addRow("final", "Direct Chat Response", data);
      }

      async function runSwarm(message) {
        const res = await fetch("/v1/swarm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, session_id: sessionId || undefined })
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || "Swarm request failed");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") {
              addRow("system", "Stream", "Completed");
              continue;
            }
            try {
              const event = JSON.parse(payload);
              if (event.type === "agent_start" && event.agent === "orchestrator") {
                try {
                  const parsed = JSON.parse(event.data);
                  if (parsed.session_id) {
                    sessionId = parsed.session_id;
                    localStorage.setItem("k2_session_id", sessionId);
                    sessionEl.textContent = sessionId;
                  }
                } catch {}
              }
              const kind = event.type === "error" ? "error" : (event.type === "final_response" ? "final" : "system");
              addRow(kind, (event.type || "event") + " · " + (event.agent || "system"), event.data);
            } catch {
              addRow("error", "Parse Error", payload);
            }
          }
        }
      }

      runBtn.addEventListener("click", async () => {
        const message = promptEl.value.trim();
        if (!message) return addRow("error", "Validation", "Prompt cannot be empty.");
        runBtn.disabled = true;
        addRow("user", "User Prompt", message);
        try {
          if (modeEl.value === "chat") {
            await runChat(message);
          } else {
            await runSwarm(message);
          }
        } catch (err) {
          addRow("error", "Request Failed", err?.message || String(err));
        } finally {
          runBtn.disabled = false;
        }
      });

      sessionEl.textContent = sessionId || "Not started";
      checkHealth();
    </script>
  </body>
</html>`);
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
  const userMessage = message;

  const sessionId = session_id ?? crypto.randomUUID();
  const history = getHistory(sessionId);

  // Persist the user message
  addMessage(sessionId, { role: "user", content: userMessage });

  // Build the SSE generator
  async function* generate(): AsyncGenerator<SSEEvent> {
    // Emit session id so the client can resume the session
    yield {
      type: "agent_start" as const,
      agent: "orchestrator" as const,
      data: JSON.stringify({ session_id: sessionId }),
    };

    let finalAnswer = "";
    for await (const event of runOrchestrator(env, userMessage, history)) {
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

function handleHealth(env: Env): Response {
  return json({
    status: "ok",
    service: "k2-swarm",
    model: "MBZUAI-IFM/K2-Think-v2",
    agents: ["orchestrator", "researcher", "coder", "writer", "critic", "summarizer", "planner", "formatter"],
    k2_configured: Boolean(env.K2_API_KEY),
    k2_base_url: env.K2_BASE_URL,
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
    const runtimeEnv = resolveEnv(env);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === "OPTIONS") return options();

    const route = `${method} ${url.pathname}`;

    switch (route) {
      case "GET /":
        return handleHome();

      case "GET /health":
        return handleHealth(runtimeEnv);

      case "GET /v1/agents":
        return handleAgentList();

      case "POST /v1/swarm":
        return handleSwarm(request, runtimeEnv);

      case "POST /v1/chat":
        return handleChat(request, runtimeEnv);

      default:
        return notFound();
    }
  },
} satisfies ExportedHandler<Env>;
