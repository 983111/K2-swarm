// ─── Tool executor ────────────────────────────────────────────────────────────
// Each function matches a tool defined in registry.ts.
// In production, web_search and read_url call real APIs.
// code_exec runs in a sandboxed environment.

export interface ToolInput {
  name: string;
  args: Record<string, string>;
}

export interface ToolOutput {
  result: string;
  error?: string;
}

// ─── web_search ───────────────────────────────────────────────────────────────

export async function execWebSearch(args: {
  query: string;
  num_results?: string;
}): Promise<ToolOutput> {
  const n = parseInt(args.num_results ?? "5", 10);

  // In production: replace with Serper, Brave Search, or Tavily API call.
  // For Cloudflare Workers, use fetch() — no Node.js modules needed.
  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", args.query);
    url.searchParams.set("count", String(n));

    // If you have a Brave Search API key in env, pass it here.
    // We'll use a mock response so the worker starts up without keys.
    const mock = {
      results: [
        {
          title: `Search: ${args.query}`,
          url: "https://example.com",
          description: `Mock result for query "${args.query}". Replace execWebSearch() with a real search API call.`,
        },
      ],
    };

    const text = mock.results
      .map((r: { title: string; url: string; description: string }, i: number) =>
        `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`
      )
      .join("\n\n");

    return { result: text };
  } catch (err) {
    return { result: "", error: String(err) };
  }
}

// ─── code_exec ────────────────────────────────────────────────────────────────

export async function execCodeExec(args: {
  language: string;
  code: string;
}): Promise<ToolOutput> {
  // Cloudflare Workers cannot spawn processes.
  // Options: (a) call an external sandbox API like e2b.dev or Piston,
  //          (b) use Cloudflare's WASM Python (pyodide) via a separate worker.
  // Below we call the Piston API (free, open-source) as the default.
  try {
    const res = await fetch("https://emkc.org/api/v2/piston/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: args.language === "javascript" ? "node" : "python3",
        version: "*",
        files: [{ name: "main", content: args.code }],
      }),
    });

    if (!res.ok) {
      return { result: "", error: `Piston API error: ${res.status}` };
    }

    const data = (await res.json()) as {
      run: { stdout: string; stderr: string; code: number };
    };

    const output = [
      data.run.stdout && `stdout:\n${data.run.stdout}`,
      data.run.stderr && `stderr:\n${data.run.stderr}`,
      `exit code: ${data.run.code}`,
    ]
      .filter(Boolean)
      .join("\n");

    return { result: output };
  } catch (err) {
    return { result: "", error: String(err) };
  }
}

// ─── read_url ─────────────────────────────────────────────────────────────────

export async function execReadUrl(args: {
  url: string;
  max_chars?: string;
}): Promise<ToolOutput> {
  const maxChars = parseInt(args.max_chars ?? "4000", 10);

  try {
    const res = await fetch(args.url, {
      headers: { "User-Agent": "K2-Swarm/1.0 (+https://github.com/k2-swarm)" },
      redirect: "follow",
    });

    if (!res.ok) {
      return { result: "", error: `HTTP ${res.status} fetching ${args.url}` };
    }

    const html = await res.text();
    // Strip HTML tags for clean text extraction
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, maxChars);

    return { result: text };
  } catch (err) {
    return { result: "", error: String(err) };
  }
}

// ─── format_output ────────────────────────────────────────────────────────────

export function execFormatOutput(args: {
  content: string;
  format: string;
  language?: string;
}): ToolOutput {
  const { content, format, language } = args;

  switch (format) {
    case "json": {
      try {
        const parsed = JSON.parse(content);
        return { result: JSON.stringify(parsed, null, 2) };
      } catch {
        // Wrap in JSON if not already valid
        return { result: JSON.stringify({ output: content }, null, 2) };
      }
    }
    case "markdown":
      return { result: content }; // Already markdown from the model
    case "bullet_list": {
      const lines = content
        .split(/\n|\.(?=\s)/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `- ${l}`);
      return { result: lines.join("\n") };
    }
    case "numbered_list": {
      const lines = content
        .split(/\n|\.(?=\s)/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l, i) => `${i + 1}. ${l}`);
      return { result: lines.join("\n") };
    }
    case "code_block":
      return { result: `\`\`\`${language ?? ""}\n${content}\n\`\`\`` };
    case "table": {
      // Try to parse as JSON array and render as markdown table
      try {
        const rows = JSON.parse(content) as Record<string, unknown>[];
        if (!Array.isArray(rows) || rows.length === 0) throw new Error();
        const headers = Object.keys(rows[0]);
        const head = `| ${headers.join(" | ")} |`;
        const sep = `| ${headers.map(() => "---").join(" | ")} |`;
        const body = rows
          .map((r) => `| ${headers.map((h) => String(r[h] ?? "")).join(" | ")} |`)
          .join("\n");
        return { result: [head, sep, body].join("\n") };
      } catch {
        return { result: content };
      }
    }
    default:
      return { result: content };
  }
}

// ─── summarize ────────────────────────────────────────────────────────────────

export function execSummarize(args: {
  text: string;
  target_length: string;
}): ToolOutput {
  // This is handled by the K2 model itself; this executor provides a fallback
  // for when the tool is called directly without LLM post-processing.
  const { text, target_length } = args;
  const words = text.split(/\s+/);

  switch (target_length) {
    case "one_sentence":
      return { result: `${words.slice(0, 30).join(" ")}...` };
    case "one_paragraph":
      return { result: `${words.slice(0, 120).join(" ")}...` };
    case "bullet_points":
      return {
        result: text
          .split(/\.\s+/)
          .slice(0, 5)
          .map((s) => `- ${s.trim()}`)
          .join("\n"),
      };
    default:
      return { result: text.slice(0, 2000) };
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function executeTool(input: ToolInput): Promise<ToolOutput> {
  switch (input.name) {
    case "web_search":
      return execWebSearch(input.args as { query: string; num_results?: string });
    case "code_exec":
      return execCodeExec(input.args as { language: string; code: string });
    case "read_url":
      return execReadUrl(input.args as { url: string; max_chars?: string });
    case "format_output":
      return execFormatOutput(
        input.args as { content: string; format: string; language?: string }
      );
    case "summarize":
      return execSummarize(
        input.args as { text: string; target_length: string }
      );
    default:
      return { result: "", error: `Unknown tool: ${input.name}` };
  }
}
