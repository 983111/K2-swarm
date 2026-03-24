# k2-swarm

Production-grade Multi-Agent Orchestration System built on **Cloudflare Workers** using the **K2-Think-v2** model (`api.k2think.ai`).

---

## Architecture

```
User Request
    │
    ▼
Orchestrator Agent  ←── plans task, routes agents, synthesizes answer
    │
    ├── Researcher   (web_search, read_url, summarize)
    ├── Coder        (code_exec, format_output)
    ├── Writer        (format_output)
    ├── Critic        (web_search)
    ├── Summarizer    (summarize, format_output)
    ├── Planner       (reasoning only)
    └── Formatter     (format_output)
         │
         ▼
    K2-Think-v2 API  ←── all agents call the same model
         │
         ▼
    SSE Stream → Client
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set your K2 API key

```bash
npm run secret
# Enter your K2 API key when prompted
```

> ⚠️ Never put your API key in `wrangler.toml`. Always use `wrangler secret`.

### 3. Run locally

```bash
npm run dev
```

The worker runs at `http://localhost:8787`.

### 4. Deploy to Cloudflare

```bash
npm run deploy            # deploys to k2-swarm.<your-subdomain>.workers.dev
npm run deploy:production # deploys to k2-swarm-production
```

### 4b. Deploy to Vercel (Edge Functions)

This repo is now Vercel-ready via `api/index.ts` + `vercel.json` and runs on the Edge Runtime.

1. In Vercel project settings, add environment variables:
   - `K2_API_KEY` (required)
   - `K2_BASE_URL` (optional, defaults to `https://api.k2think.ai/v1`)
2. Deploy:

```bash
npm run deploy:vercel
```

For local Vercel dev:

```bash
npm run dev:vercel
```

---

## API Reference

### `GET /health`

Returns system status and agent list.

```json
{
  "status": "ok",
  "service": "k2-swarm",
  "model": "MBZUAI-IFM/K2-Think-v2",
  "agents": ["orchestrator", "researcher", "coder", "writer", ...]
}
```

---

### `GET /v1/agents`

Lists all available agents and their tools.

---

### `POST /v1/swarm` — Main endpoint

Runs the full orchestration pipeline. Streams Server-Sent Events.

**Request:**
```json
{
  "message": "Research the latest advancements in quantum computing and write a 500-word article about them",
  "session_id": "optional-uuid-for-conversation-continuity"
}
```

**Response:** `text/event-stream`

Each SSE event is a JSON object on the `data:` field:

| `type`               | Description                                      |
|----------------------|--------------------------------------------------|
| `orchestrator_plan`  | JSON plan of which agents will run               |
| `agent_start`        | Agent begins working on a task                   |
| `agent_token`        | Streaming token from the agent                   |
| `agent_tool_call`    | Agent calls a tool (name + args)                 |
| `agent_tool_result`  | Tool execution result                            |
| `agent_done`         | Agent finished — full output in `data`           |
| `final_response`     | Synthesized final answer from the orchestrator   |
| `error`              | An error occurred                                |

**Example curl:**
```bash
curl -X POST http://localhost:8787/v1/swarm \
  -H "Content-Type: application/json" \
  -d '{"message": "Write a Python function to calculate Fibonacci numbers and test it"}' \
  --no-buffer
```

**Example JavaScript client:**
```javascript
const res = await fetch('https://k2-swarm.vishwajeetadkine.workers.dev/v1/swarm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Research and summarize the latest AI news' })
});

const reader = res.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
    const event = JSON.parse(line.slice(6));

    switch (event.type) {
      case 'orchestrator_plan':
        console.log('Plan:', JSON.parse(event.data));
        break;
      case 'agent_start':
        console.log(`▶ ${event.agent} started`);
        break;
      case 'agent_token':
        process.stdout.write(event.data); // stream tokens live
        break;
      case 'agent_done':
        console.log(`\n✓ ${event.agent} done`);
        break;
      case 'final_response':
        console.log('\n\n=== FINAL ANSWER ===\n', event.data);
        break;
      case 'error':
        console.error('Error:', event.data);
        break;
    }
  }
}
```

---

### `POST /v1/chat` — Direct chat (no orchestration)

Simple single-turn call to K2, useful for testing the API connection.

```bash
curl -X POST http://localhost:8787/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, are you working?"}'
```

---

## Adding Real Tool Implementations

### Web Search (Brave Search API)

In `src/tools/executor.ts`, replace the mock in `execWebSearch` with:

```typescript
const res = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(args.query), {
  headers: { 'Accept': 'application/json', 'X-Subscription-Token': env.BRAVE_API_KEY }
});
const data = await res.json();
```

Add `BRAVE_API_KEY` to your `Env` type and set it as a secret:
```bash
wrangler secret put BRAVE_API_KEY
```

### Code Execution (Piston API)

Already implemented — uses the free [Piston API](https://github.com/engineer-man/piston). No key needed.

For production, self-host Piston or replace with [e2b.dev](https://e2b.dev).

---

## File Structure

```
k2-swarm/
├── src/
│   ├── index.ts          Worker entrypoint (routing + SSE)
│   ├── orchestrator.ts   Master planner + synthesizer
│   ├── k2client.ts       K2 API client (streaming + tool calling)
│   ├── memory.ts         In-memory session store
│   ├── stream.ts         SSE encoding helpers
│   ├── types.ts          Shared TypeScript types
│   ├── agents/
│   │   └── index.ts      All 7 specialist agents
│   └── tools/
│       ├── registry.ts   Tool schemas (function calling)
│       └── executor.ts   Tool implementations
├── api/
│   └── index.ts          Vercel Edge entrypoint
├── wrangler.toml
├── vercel.json           Vercel routing/runtime config
├── package.json
└── tsconfig.json
```

---

## Environment Variables

| Variable      | Where to set         | Required |
|---------------|----------------------|----------|
| `K2_API_KEY`  | Cloudflare secret or Vercel env | ✅ Yes   |
| `K2_BASE_URL` | `wrangler.toml` vars or Vercel env | Optional (defaults to K2 API URL) |
| `BRAVE_API_KEY` | Cloudflare secret or Vercel env | Optional |

---

## Production Notes

- Cloudflare Workers **free tier** has a 10ms CPU limit — this system needs the **Paid plan** (Workers Paid) for LLM calls.
- Memory is **per-request** (Cloudflare Workers are stateless). For cross-request persistence, swap `memory.ts` for Cloudflare **KV** or **D1**.
- Each streaming request can last up to **30 seconds** on the Paid plan.
- Worker logs: `npm run tail` (local) or `npm run tail:production`.

---

## License

MIT
