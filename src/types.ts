// ─── Core message types ───────────────────────────────────────────────────────

export type Role = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: Role;
  content: string;
  name?: string;        // tool name when role === "tool"
  tool_call_id?: string;
}

// ─── Tool calling ─────────────────────────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameter>;
  required?: string[];
  items?: ToolParameter;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameter>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// ─── K2 API types ─────────────────────────────────────────────────────────────

export interface K2Request {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

export interface K2Choice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: "stop" | "tool_calls" | "length" | null;
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: Partial<ToolCall>[];
  };
}

export interface K2Response {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: K2Choice[];
}

// ─── Agent types ──────────────────────────────────────────────────────────────

export type AgentName =
  | "orchestrator"
  | "researcher"
  | "coder"
  | "writer"
  | "critic"
  | "summarizer"
  | "planner"
  | "formatter";

export interface AgentTask {
  id: string;
  agentName: AgentName;
  instruction: string;
  context?: string;       // output from previous agents fed in
  parentTaskId?: string;
}

export interface AgentResult {
  taskId: string;
  agentName: AgentName;
  output: string;
  toolsUsed?: string[];
  error?: string;
}

// ─── Orchestration plan ───────────────────────────────────────────────────────

export interface OrchestratorPlan {
  steps: Array<{
    agentName: AgentName;
    instruction: string;
    dependsOn?: string[]; // task ids this step waits for
  }>;
  synthesisInstruction: string;
}

// ─── Session / memory ─────────────────────────────────────────────────────────

export interface Session {
  id: string;
  history: Message[];
  agentResults: AgentResult[];
  createdAt: number;
  lastActiveAt: number;
}

// ─── SSE event types ──────────────────────────────────────────────────────────

export type SSEEventType =
  | "agent_start"
  | "agent_token"
  | "agent_tool_call"
  | "agent_tool_result"
  | "agent_done"
  | "orchestrator_plan"
  | "final_response"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  agent?: AgentName;
  data: string;
  taskId?: string;
}

// ─── Env bindings (Cloudflare Worker) ────────────────────────────────────────

export interface Env {
  K2_API_KEY: string;
  K2_BASE_URL: string; // https://api.k2think.ai/v1
}
