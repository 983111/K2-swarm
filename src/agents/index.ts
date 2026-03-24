import type { AgentTask, AgentResult, SSEEvent, Env } from "../types";
import { completeStream } from "../k2client";
import { AGENT_TOOLS } from "../tools/registry";

// ─── Base agent runner ────────────────────────────────────────────────────────

async function* runAgent(
  env: Env,
  task: AgentTask,
  systemPrompt: string
): AsyncGenerator<SSEEvent> {
  const agentName = task.agentName;
  yield { type: "agent_start", agent: agentName, data: task.instruction, taskId: task.id };

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...(task.context
      ? [
          {
            role: "user" as const,
            content: `Context from previous steps:\n${task.context}`,
          },
        ]
      : []),
    { role: "user" as const, content: task.instruction },
  ];

  let fullContent = "";
  const tools = AGENT_TOOLS[agentName] ?? [];

  try {
    for await (const event of completeStream(env, messages, { tools })) {
      if (event.type === "token") {
        fullContent += event.content;
        yield { type: "agent_token", agent: agentName, data: event.content, taskId: task.id };
      } else if (event.type === "tool_call") {
        yield {
          type: "agent_tool_call",
          agent: agentName,
          data: JSON.stringify({ tool: event.name, args: event.args }),
          taskId: task.id,
        };
      } else if (event.type === "tool_result") {
        yield {
          type: "agent_tool_result",
          agent: agentName,
          data: JSON.stringify({ tool: event.name, result: event.result }),
          taskId: task.id,
        };
      } else if (event.type === "done") {
        fullContent = event.content;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: "error", agent: agentName, data: msg, taskId: task.id };
  }

  yield { type: "agent_done", agent: agentName, data: fullContent, taskId: task.id };
}

// ─── 1. Researcher ────────────────────────────────────────────────────────────

const RESEARCHER_SYSTEM = `You are a Researcher Agent in a multi-agent AI system.
Your job: gather accurate, up-to-date information on a given topic using web search and URL reading.
Guidelines:
- Always search before answering factual questions.
- Cite sources (URL) for every key claim.
- Summarize findings concisely and clearly.
- Output raw research notes, not polished prose — another agent will write the final copy.`;

export async function* runResearcher(
  env: Env,
  task: AgentTask
): AsyncGenerator<SSEEvent> {
  yield* runAgent(env, task, RESEARCHER_SYSTEM);
}

// ─── 2. Coder ─────────────────────────────────────────────────────────────────

const CODER_SYSTEM = `You are a Coder Agent in a multi-agent AI system.
Your job: write, review, debug, and execute code.
Guidelines:
- Write clean, idiomatic code with comments.
- Always verify code by running it with the code_exec tool.
- Return the final working code in a fenced code block.
- Note the language, dependencies, and how to run it.
- If you find a bug, fix it and re-run until tests pass.`;

export async function* runCoder(
  env: Env,
  task: AgentTask
): AsyncGenerator<SSEEvent> {
  yield* runAgent(env, task, CODER_SYSTEM);
}

// ─── 3. Writer ────────────────────────────────────────────────────────────────

const WRITER_SYSTEM = `You are a Writer Agent in a multi-agent AI system.
Your job: produce high-quality written content — articles, explanations, reports, emails, documentation.
Guidelines:
- Write in clear, engaging prose. Match the requested tone.
- Structure content with appropriate headings, paragraphs, and lists.
- Use research notes provided in context — do not invent facts.
- Produce complete, publication-ready output.`;

export async function* runWriter(
  env: Env,
  task: AgentTask
): AsyncGenerator<SSEEvent> {
  yield* runAgent(env, task, WRITER_SYSTEM);
}

// ─── 4. Critic ────────────────────────────────────────────────────────────────

const CRITIC_SYSTEM = `You are a Critic Agent in a multi-agent AI system.
Your job: review and improve outputs from other agents.
Guidelines:
- Identify factual errors, logical gaps, and unclear writing.
- Check for completeness — does the output fully answer the original request?
- Provide specific, actionable feedback with suggested fixes.
- If the output is good, say so and explain why.
- Return: (1) a score 1-10, (2) issues found, (3) improved version if needed.`;

export async function* runCritic(
  env: Env,
  task: AgentTask
): AsyncGenerator<SSEEvent> {
  yield* runAgent(env, task, CRITIC_SYSTEM);
}

// ─── 5. Summarizer ────────────────────────────────────────────────────────────

const SUMMARIZER_SYSTEM = `You are a Summarizer Agent in a multi-agent AI system.
Your job: condense long content into concise, accurate summaries.
Guidelines:
- Preserve all key facts, decisions, and conclusions.
- Remove redundancy and filler.
- Match the requested output format (bullet points, paragraph, etc.).
- Never add information not present in the input.`;

export async function* runSummarizer(
  env: Env,
  task: AgentTask
): AsyncGenerator<SSEEvent> {
  yield* runAgent(env, task, SUMMARIZER_SYSTEM);
}

// ─── 6. Planner ───────────────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a Planner Agent in a multi-agent AI system.
Your job: break complex goals into clear, ordered steps.
Guidelines:
- Output a numbered action plan with concrete, specific steps.
- Include estimated effort for each step (low / medium / high).
- Flag dependencies — which steps must complete before others.
- Keep steps small enough for a single agent to complete in one turn.`;

export async function* runPlanner(
  env: Env,
  task: AgentTask
): AsyncGenerator<SSEEvent> {
  yield* runAgent(env, task, PLANNER_SYSTEM);
}

// ─── 7. Formatter ────────────────────────────────────────────────────────────

const FORMATTER_SYSTEM = `You are a Formatter Agent in a multi-agent AI system.
Your job: transform raw content into the exact output format requested.
Guidelines:
- Produce clean JSON, markdown, tables, or code blocks as required.
- Validate JSON before outputting — it must parse correctly.
- For markdown: use appropriate heading levels, spacing, and code fencing.
- Never change the meaning or add content — only restructure.`;

export async function* runFormatter(
  env: Env,
  task: AgentTask
): AsyncGenerator<SSEEvent> {
  yield* runAgent(env, task, FORMATTER_SYSTEM);
}

// ─── Agent dispatcher ─────────────────────────────────────────────────────────

export async function* dispatchAgent(
  env: Env,
  task: AgentTask
): AsyncGenerator<SSEEvent> {
  switch (task.agentName) {
    case "researcher": yield* runResearcher(env, task); break;
    case "coder":      yield* runCoder(env, task);      break;
    case "writer":     yield* runWriter(env, task);     break;
    case "critic":     yield* runCritic(env, task);     break;
    case "summarizer": yield* runSummarizer(env, task); break;
    case "planner":    yield* runPlanner(env, task);    break;
    case "formatter":  yield* runFormatter(env, task);  break;
    default:
      yield { type: "error", data: `Unknown agent: ${task.agentName}` };
  }
}
