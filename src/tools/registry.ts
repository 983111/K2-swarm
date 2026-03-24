import type { ToolDefinition } from "../types";

// ─── Tool schemas ─────────────────────────────────────────────────────────────

export const WEB_SEARCH: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information. Use for facts, news, documentation, and any topic requiring up-to-date data.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query, specific and concise (≤10 words).",
        },
        num_results: {
          type: "string",
          enum: ["3", "5", "10"],
          description: "Number of results to return. Default 5.",
        },
      },
      required: ["query"],
    },
  },
};

export const CODE_EXEC: ToolDefinition = {
  type: "function",
  function: {
    name: "code_exec",
    description:
      "Execute Python code in a sandboxed environment and return stdout/stderr. Use for calculations, data processing, and verifying code correctness.",
    parameters: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: ["python", "javascript"],
          description: "Programming language to execute.",
        },
        code: {
          type: "string",
          description: "The code to execute.",
        },
      },
      required: ["language", "code"],
    },
  },
};

export const READ_URL: ToolDefinition = {
  type: "function",
  function: {
    name: "read_url",
    description:
      "Fetch and extract readable text content from a URL. Use to read articles, documentation, or any web page.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch (must start with https://).",
        },
        max_chars: {
          type: "string",
          description: "Max characters to return. Default 4000.",
        },
      },
      required: ["url"],
    },
  },
};

export const FORMAT_OUTPUT: ToolDefinition = {
  type: "function",
  function: {
    name: "format_output",
    description:
      "Format a response into a specific structure. Use to produce JSON, markdown tables, bullet lists, or code blocks.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The raw content to format.",
        },
        format: {
          type: "string",
          enum: ["json", "markdown", "bullet_list", "numbered_list", "code_block", "table"],
          description: "Target output format.",
        },
        language: {
          type: "string",
          description: "For code_block format: the programming language.",
        },
      },
      required: ["content", "format"],
    },
  },
};

export const SUMMARIZE: ToolDefinition = {
  type: "function",
  function: {
    name: "summarize",
    description:
      "Condense a long text into a shorter summary while preserving key information.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text to summarize.",
        },
        target_length: {
          type: "string",
          enum: ["one_sentence", "one_paragraph", "bullet_points", "detailed"],
          description: "Desired summary length.",
        },
      },
      required: ["text", "target_length"],
    },
  },
};

// ─── Registry maps ─────────────────────────────────────────────────────────────

// All available tools indexed by name
export const ALL_TOOLS: Record<string, ToolDefinition> = {
  web_search: WEB_SEARCH,
  code_exec: CODE_EXEC,
  read_url: READ_URL,
  format_output: FORMAT_OUTPUT,
  summarize: SUMMARIZE,
};

// Tools available to each agent
export const AGENT_TOOLS: Record<string, ToolDefinition[]> = {
  orchestrator: [],                           // Orchestrator only plans — no tools
  researcher: [WEB_SEARCH, READ_URL, SUMMARIZE],
  coder: [CODE_EXEC, FORMAT_OUTPUT],
  writer: [FORMAT_OUTPUT],
  critic: [WEB_SEARCH],
  summarizer: [SUMMARIZE, FORMAT_OUTPUT],
  planner: [],                                // Planner reasons only
  formatter: [FORMAT_OUTPUT],
};
