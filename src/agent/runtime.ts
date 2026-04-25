import { formatToolResult, tryParseJsonContent, type ServiceToolResult } from "../backend/protocol";
import type { ModelProvider, ProviderKind } from "../providers/base";
import type { ModelProviderRegistry } from "../providers/registry";
import type { PreviewRunOutcome, SessionStore } from "../state/sessionStore";

import { buildAgentContext } from "./contextBuilder";
import { AgentMemoryBridge } from "./memoryBridge";
import { AgentPlanner } from "./planner";
import { traceEntry, type AgentTraceEntry } from "./trace";
import type { AgentPlan, AgentRuntimeMode } from "./types";
import { budgetSelectedText, budgetToolResult } from "./contextBudget";
import { extractFirstJsonObject as safeExtractJson } from "./jsonExtract";


export interface AgentCancellationSignal {
  readonly isCancellationRequested: boolean;
}

export class AgentRuntimeCancelledError extends Error {
  public constructor(message = "Token Savior agent run was cancelled.") {
    super(message);
    this.name = "AgentRuntimeCancelledError";
  }
}

export interface AgentToolExecutor {
  invokeTool(
    workspaceRoot: string,
    name: string,
    argumentsPayload: Record<string, unknown>,
  ): Promise<ServiceToolResult>;
}

export interface AgentRuntimeDependencies {
  workspaceRoot: string;
  providerRegistry: ModelProviderRegistry;
  toolExecutor: AgentToolExecutor;
  sessionStore?: SessionStore;
}

export interface AgentPreviewInput {
  query: string;
  selectedText?: string;
  activeFilePath?: string;
  maxToolSteps?: number;
  cancellationSignal?: AgentCancellationSignal;
}

export interface AgentPreviewResult {
  query: string;
  mode?: AgentRuntimeMode;
  plan: AgentPlan;
  answer: string;
  providerKind?: ProviderKind;
  toolResult?: ServiceToolResult;
  plans?: AgentPlan[];
  toolResults?: ServiceToolResult[];
  trace: AgentTraceEntry[];
}

function getToolResults(result: AgentPreviewResult): ServiceToolResult[] {
  if (result.toolResults && result.toolResults.length > 0) {
    return [...result.toolResults];
  }

  return result.toolResult ? [result.toolResult] : [];
}

export function isToolResultFailure(result: ServiceToolResult): boolean {
  if (!result.ok) {
    return true;
  }

  const parsed = tryParseJsonContent<Record<string, unknown>>(result);
  return parsed?.ok === false;
}

export function deriveToolResultFailureMessage(result: ServiceToolResult): string | undefined {
  if (!isToolResultFailure(result)) {
    return undefined;
  }

  if (result.error && result.error.trim().length > 0) {
    return `${result.name}: ${result.error.trim()}`;
  }

  const parsed = tryParseJsonContent<Record<string, unknown>>(result);
  const summary = parsed && typeof parsed.summary === "object"
    ? parsed.summary as Record<string, unknown>
    : undefined;
  const validation = parsed && typeof parsed.validation === "object"
    ? parsed.validation as Record<string, unknown>
    : undefined;
  const validationSummary = validation && typeof validation.summary === "object"
    ? validation.summary as Record<string, unknown>
    : undefined;
  const candidate = [
    typeof parsed?.error === "string" ? parsed.error : undefined,
    typeof summary?.headline === "string" ? summary.headline : undefined,
    typeof validation?.headline === "string" ? validation.headline : undefined,
    typeof validationSummary?.headline === "string" ? validationSummary.headline : undefined,
  ].find((value): value is string => Boolean(value && value.trim().length > 0));

  if (candidate) {
    return `${result.name}: ${candidate.trim()}`;
  }

  const body = formatToolResult(result).trim();
  if (body.length > 0) {
    return `${result.name}: ${body}`;
  }

  return undefined;
}

export function deriveRunOutcome(result: AgentPreviewResult): PreviewRunOutcome {
  return getToolResults(result).some((toolResult) => isToolResultFailure(toolResult)) ? "failed" : "completed";
}

export function deriveRunFailureMessage(result: AgentPreviewResult): string | undefined {
  const toolResults = getToolResults(result);
  for (let index = toolResults.length - 1; index >= 0; index -= 1) {
    const toolResult = toolResults[index];
    if (!isToolResultFailure(toolResult)) {
      continue;
    }

    return deriveToolResultFailureMessage(toolResult);
  }

  return undefined;
}

function throwIfCancelled(signal?: AgentCancellationSignal): void {
  if (signal?.isCancellationRequested) {
    throw new AgentRuntimeCancelledError();
  }
}

function formatToolResultsForSummary(results: readonly ServiceToolResult[]): string {
  return results.map((result, index) => [
    `Tool step ${index + 1}: ${result.name}`,
    formatToolResult(result),
  ].join("\n")).join("\n\n");
}

async function resolveProvider(
  registry: ModelProviderRegistry,
): Promise<ModelProvider | undefined> {
  try {
    return await registry.resolvePreferredProvider();
  } catch {
    return undefined;
  }
}

async function summarizeToolResult(
  provider: ModelProvider,
  mode: AgentRuntimeMode,
  query: string,
  plans: readonly AgentPlan[],
  toolText: string,
  contextText?: string,
): Promise<string | undefined> {
  try {
    const response = await provider.complete({
      messages: [
        {
          role: "system",
          content: [
            mode === "action"
              ? "You are a coding assistant inside VS Code summarizing an approved bounded action workflow."
              : "You are a read-only coding assistant inside VS Code.",
            mode === "action"
              ? "Summarize the action outcome, including what ran, whether it succeeded, and any next caution the user should know."
              : "Summarize the tool result or tool sequence to answer the user's question.",
            "Stay grounded in the provided tool output only.",
            "If the tool output contains an error, explain it briefly and suggest a safer follow-up.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Runtime mode: ${mode}`,
            `User query: ${query}`,
            `Plan sequence: ${plans.map((plan) => plan.kind === "tool" ? plan.toolName : "direct").join(" -> ")}`,
            `Additional context:\n${contextText ?? "<none>"}`,
            `Tool result:\n${toolText}`,
          ].join("\n\n"),
        },
      ],
      justification: "Summarize a backend tool result for the Token Savior preview agent.",
    });

    const text = response.text.trim();
    return text.length > 0 ? text : undefined;
  } catch {
    return undefined;
  }
}

export class AgentRuntime {
  private readonly planner = new AgentPlanner();

  public constructor(private readonly dependencies: AgentRuntimeDependencies) {}

  public async runPreview(input: AgentPreviewInput): Promise<AgentPreviewResult> {
    return this.run(input, "preview");
  }

  public async runAction(input: AgentPreviewInput): Promise<AgentPreviewResult> {
    return this.run(input, "action");
  }

  private async run(input: AgentPreviewInput, mode: AgentRuntimeMode): Promise<AgentPreviewResult> {
    const trace: AgentTraceEntry[] = [];
    // FIX-8: Bridge AgentCancellationSignal into an AbortController so that
    // fetch-based tool calls (local provider) can be cancelled mid-flight.
    const abortController = new AbortController();
    if (input.cancellationSignal) {
      const pollId = setInterval(() => {
        if (input.cancellationSignal?.isCancellationRequested) {
          abortController.abort();
          clearInterval(pollId);
        }
      }, 200);
      abortController.signal.addEventListener("abort", () => clearInterval(pollId));
    }

    let step = 1;
    const maxToolSteps = Math.max(input.maxToolSteps ?? (mode === "action" ? 3 : 2), 1);
    throwIfCancelled(input.cancellationSignal);
    if (mode === "action") {
      trace.push(traceEntry(step++, "control", "Running the agent in bounded action mode with approval-gated tool execution."));
    }
    let supplementalContext: string | undefined;
    if (this.dependencies.sessionStore) {
      const memoryBridge = new AgentMemoryBridge({
        workspaceRoot: this.dependencies.workspaceRoot,
        toolExecutor: this.dependencies.toolExecutor,
        sessionStore: this.dependencies.sessionStore,
      });
      const memoryContext = await memoryBridge.buildContext(input.query);
      supplementalContext = buildAgentContext({
        selectedText: input.selectedText,
        activeFilePath: input.activeFilePath,
        memoryContext,
      });
      if (supplementalContext) {
        trace.push(traceEntry(step++, "context", "Built bounded runtime context.", {
          hasSelectedText: Boolean(input.selectedText),
          hasActiveFile: Boolean(input.activeFilePath),
          hasProjectMemory: Boolean(memoryContext.projectMemory),
          hasSessionHistory: Boolean(memoryContext.sessionHistory),
          recentRuns: memoryContext.recentRuns.length,
        }));
      }
    }

    const provider = await resolveProvider(this.dependencies.providerRegistry);
    if (provider) {
      trace.push(traceEntry(step++, "provider", "Resolved model provider.", { kind: provider.kind }));
    } else {
      trace.push(traceEntry(step++, "provider", "No model provider available; using heuristic planning."));
    }

    let currentPlan = await this.planner.plan({
      query: input.query,
      selectedText: input.selectedText,
      activeFilePath: input.activeFilePath,
      mode,
      provider,
      context: supplementalContext,
    });
    const plans: AgentPlan[] = [];
    const toolResults: ServiceToolResult[] = [];
    const pushPlanTrace = (plan: AgentPlan, iteration: number): void => {
      trace.push(traceEntry(step++, "plan", iteration === 1 ? "Generated agent plan." : "Generated follow-up plan.", {
        iteration,
        kind: plan.kind,
        source: plan.source,
        reasoning: plan.reasoning,
        ...(plan.kind === "tool" ? { toolName: plan.toolName } : {}),
      }));
    };

    pushPlanTrace(currentPlan, 1);
    plans.push(currentPlan);

    if (currentPlan.kind === "direct") {
      trace.push(traceEntry(step++, "answer", "Returned a direct response without calling backend tools."));
      return {
        query: input.query,
        mode,
        plan: currentPlan,
        plans,
        answer: currentPlan.response,
        providerKind: provider?.kind,
        trace,
      };
    }

    while (currentPlan.kind === "tool") {
      throwIfCancelled(input.cancellationSignal);
      trace.push(traceEntry(step++, "tool", "Invoking backend tool.", {
        toolName: currentPlan.toolName,
        arguments: currentPlan.arguments,
        iteration: toolResults.length + 1,
      }));
      // FIX-5: Wrap each tool step so a transient error surfaces cleanly.
      // FIX-4: Timeout is enforced inside gateway.invokeTool.
      let toolResult: import("../backend/protocol").ServiceToolResult;
      try {
        toolResult = await this.dependencies.toolExecutor.invokeTool(
          this.dependencies.workspaceRoot,
          currentPlan.toolName,
          currentPlan.arguments,
          abortController.signal,
        );
      } catch (toolError) {
        const msg = toolError instanceof Error ? toolError.message : String(toolError);
        trace.push(traceEntry(step++, "tool", `Tool call failed: ${msg}`, {
          toolName: currentPlan.toolName,
          error: msg,
        }));
        toolResult = {
          name: currentPlan.toolName,
          ok: false,
          content: [`Error: ${msg}`],
          error: msg,
          active_project: null,
        };
      }
      toolResults.push(toolResult);
      trace.push(traceEntry(step++, "tool", "Backend tool returned.", {
        toolName: currentPlan.toolName,
        ok: toolResult.ok,
        iteration: toolResults.length,
      }));
      throwIfCancelled(input.cancellationSignal);

      if (toolResults.length >= maxToolSteps) {
        trace.push(traceEntry(step++, "control", "Reached the bounded max tool-step limit; stopping tool execution.", {
          maxToolSteps,
        }));
        break;
      }

      const nextPlan = await this.planner.planFollowUp({
        query: input.query,
        selectedText: input.selectedText,
        activeFilePath: input.activeFilePath,
        mode,
        provider,
        context: supplementalContext,
        previousPlans: plans,
        previousToolResults: toolResults,
      });

      if (!nextPlan) {
        trace.push(traceEntry(step++, "control", "No further safe tool step was needed; stopping after current results."));
        break;
      }

      currentPlan = nextPlan;
      plans.push(currentPlan);
      pushPlanTrace(currentPlan, plans.length);

      if (currentPlan.kind === "direct") {
        trace.push(traceEntry(step++, "answer", "Returned a direct answer after reviewing earlier tool results."));
        return {
          query: input.query,
          mode,
          plan: plans[0],
          plans,
          answer: currentPlan.response,
          providerKind: provider?.kind,
          toolResult: toolResults.at(-1),
          toolResults,
          trace,
        };
      }
    }

    const toolText = formatToolResultsForSummary(toolResults);
    const summarized = provider
      ? await summarizeToolResult(provider, mode, input.query, plans, toolText, supplementalContext)
      : undefined;
    if (summarized) {
      trace.push(traceEntry(step++, "answer", "Summarized tool result with the selected provider."));
    } else {
      trace.push(traceEntry(step++, "answer", "Used raw tool output as the final answer."));
    }

    return {
      query: input.query,
      mode,
      plan: plans[0],
      plans,
      answer: summarized ?? toolText,
      providerKind: provider?.kind,
      toolResult: toolResults.at(-1),
      toolResults,
      trace,
    };
  }
}
