import type {
  AgentName,
  AgentTask,
  AgentResult,
  OrchestratorPlan,
  SSEEvent,
  Env,
  Message,
} from "./types";
import { complete } from "./k2client";
import { dispatchAgent } from "./agents/index";

// ─── Orchestrator system prompt ───────────────────────────────────────────────

const ORCHESTRATOR_SYSTEM = `You are the Orchestrator in a multi-agent AI system.
You coordinate a swarm of 7 specialist agents to complete complex tasks.

Available agents:
- researcher: Gathers facts and information using web search.
- coder: Writes, debugs, and runs code.
- writer: Produces polished long-form written content.
- critic: Reviews and improves output from other agents.
- summarizer: Condenses long content into concise summaries.
- planner: Breaks complex goals into ordered action steps.
- formatter: Converts raw output into JSON, markdown, tables, etc.

Your job:
1. Analyze the user request.
2. Decide which agents are needed and in what order.
3. Return a JSON plan (array of steps) — nothing else.

Plan format (return ONLY valid JSON, no commentary):
{
  "steps": [
    {
      "agentName": "<agent>",
      "instruction": "<specific instruction for this agent>",
      "dependsOn": []
    }
  ],
  "synthesisInstruction": "<how to combine agent outputs into a final answer>"
}

Rules:
- Keep each step's instruction concrete and self-contained.
- Use researcher first when facts are needed.
- Use critic after writer/coder for quality assurance.
- Use formatter last when a specific output format is required.
- Minimum 2 agents, maximum 7 agents per plan.
- dependsOn is an array of step indices (0-based) that must finish first.`;

// ─── Plan parser ──────────────────────────────────────────────────────────────

function parsePlan(raw: string): OrchestratorPlan {
  // Extract JSON even if the model wraps it in markdown fences
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ??
                raw.match(/(\{[\s\S]*\})/);
  const jsonStr = match?.[1] ?? raw;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    // Validate shape
    if (!Array.isArray(parsed.steps) || !parsed.synthesisInstruction) {
      throw new Error("Invalid plan shape");
    }
    return parsed as OrchestratorPlan;
  } catch {
    // Fallback: single writer agent
    return {
      steps: [
        {
          agentName: "writer",
          instruction: raw,
          dependsOn: [],
        },
      ],
      synthesisInstruction: "Return the writer output as the final answer.",
    };
  }
}

// ─── Orchestrator run ─────────────────────────────────────────────────────────

export async function* runOrchestrator(
  env: Env,
  userMessage: string,
  conversationHistory: Message[]
): AsyncGenerator<SSEEvent> {
  // ── Step 1: Build the plan ──────────────────────────────────────────────────
  const planMessages: Message[] = [
    ...conversationHistory.slice(-10), // last 10 turns for context
    { role: "user", content: userMessage },
  ];

  let planRaw: string;
  try {
    const { content } = await complete(env, planMessages, {
      temperature: 0.3, // low temp for deterministic planning
      max_tokens: 1024,
    });
    // The orchestrator system prompt is passed via the messages array below
    const planResult = await complete(
      env,
      [
        { role: "system", content: ORCHESTRATOR_SYSTEM },
        { role: "user", content: `User request: ${userMessage}` },
      ],
      { temperature: 0.2, max_tokens: 1024 }
    );
    planRaw = planResult.content;
  } catch (err) {
    yield { type: "error", data: `Orchestrator planning failed: ${err}` };
    return;
  }

  const plan = parsePlan(planRaw);
  yield { type: "orchestrator_plan", data: JSON.stringify(plan) };

  // ── Step 2: Execute agents in dependency order ───────────────────────────────
  const results: AgentResult[] = [];
  const completed = new Set<number>();

  // Simple topological execution: keep looping until all steps are done
  const maxPasses = plan.steps.length * 2;
  for (let pass = 0; pass < maxPasses && completed.size < plan.steps.length; pass++) {
    for (let i = 0; i < plan.steps.length; i++) {
      if (completed.has(i)) continue;

      const step = plan.steps[i];
      const deps = step.dependsOn ?? [];
      if (!deps.every((d) => completed.has(d))) continue; // wait for deps

      // Build context from dependent results
      const context = deps
        .map((d) => {
          const r = results[d];
          return r ? `[${r.agentName} output]:\n${r.output}` : "";
        })
        .filter(Boolean)
        .join("\n\n");

      const task: AgentTask = {
        id: `task-${i}`,
        agentName: step.agentName as AgentName,
        instruction: step.instruction,
        context: context || undefined,
        parentTaskId: "orchestrator",
      };

      let agentOutput = "";
      for await (const event of dispatchAgent(env, task)) {
        yield event;
        if (event.type === "agent_done") {
          agentOutput = event.data;
        }
      }

      results[i] = {
        taskId: task.id,
        agentName: task.agentName,
        output: agentOutput,
      };
      completed.add(i);
    }
  }

  // ── Step 3: Synthesize final answer ─────────────────────────────────────────
  const allOutputs = results
    .map((r, i) => `[Step ${i + 1} — ${r.agentName}]:\n${r.output}`)
    .join("\n\n---\n\n");

  const synthMessages: Message[] = [
    {
      role: "system",
      content: `You are synthesizing the outputs of multiple specialist agents into a single, coherent final answer for the user.`,
    },
    {
      role: "user",
      content: `Original request: ${userMessage}\n\nAgent outputs:\n${allOutputs}\n\nSynthesis instruction: ${plan.synthesisInstruction}\n\nProvide the final, unified answer:`,
    },
  ];

  let finalAnswer = "";
  try {
    const { content } = await complete(env, synthMessages, {
      temperature: 0.5,
      max_tokens: 2048,
    });
    finalAnswer = content;
  } catch (err) {
    // Fall back to last agent's output
    finalAnswer = results[results.length - 1]?.output ?? "No output produced.";
  }

  yield { type: "final_response", data: finalAnswer };
}
