import type { ModelProvider } from "../providers/base";
import { formatToolResult, type ToolResult, type ToolDefinition } from "../tools/interface";

import type { AgentPlan, AgentRuntimeMode, AgentToolName } from "./types";

export interface AgentPlannerInput {
  query: string;
  selectedText?: string;
  activeFilePath?: string;
  mode?: AgentRuntimeMode;
  provider?: ModelProvider;
  context?: string;
  /** Pre-built tool manifest from ToolRegistry.buildToolManifestForPrompt() for the LLM prompt. */
  toolManifest?: string;
  /** Set of currently registered tool names. undefined = accept any (compat mode). Empty set = no tools. */
  knownToolNames?: ReadonlySet<string>;
  /** Task 2/5: full tool definitions for keyword-based heuristic selection. */
  toolDefinitions?: ToolDefinition[];
}

export interface AgentPlannerFollowUpInput extends AgentPlannerInput {
  previousPlans: AgentPlan[];
  previousToolResults: ToolResult[];
  /** Task 4: hint that the last tool result failed so the planner tries a corrective approach. */
  previousResultFailed?: boolean;
}

type ModelPlanPayload = {
  mode?: "direct" | "tool";
  response?: string;
  reasoning?: string;
  toolName?: AgentToolName;
  arguments?: Record<string, unknown>;
};

function isLikelySymbolName(text: string | undefined): text is string {
  if (!text) {
    return false;
  }

  const normalized = text.trim();
  return /^[A-Za-z_][\w.:/-]*$/.test(normalized);
}

function extractLikelyProjectActionId(query: string): string | undefined {
  const quoted = query.match(/(?:project action|action id|action)\s+[`"']([A-Za-z0-9:_-]+)[`"']/i);
  if (quoted?.[1]) {
    return quoted[1];
  }

  const plain = query.match(/(?:project action|action id|action)\s+([A-Za-z0-9:_-]+)/i);
  return plain?.[1];
}

function extractLikelySymbolName(query: string, selectedText?: string): string | undefined {
  const selected = selectedText?.trim();
  if (isLikelySymbolName(selected)) {
    return selected;
  }

  const quoted = query.match(/[`"']([^`"']+)[`"']/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const symbolMatch = query.match(/(?:symbol|function|class|method)\s+([A-Za-z_][\w.:/-]*)/i);
  if (symbolMatch?.[1]) {
    return symbolMatch[1].trim();
  }

  const trailing = query.match(/(?:find|locate|where is|show)\s+([A-Za-z_][\w.:/-]*)/i);
  if (trailing?.[1]) {
    return trailing[1].trim();
  }

  const naturalQuestion = query.match(/(?:impact of changing|change impact of|impact of|does|changing|change|analyze|explain)\s+([A-Za-z_][\w.:/-]*)/i);
  if (naturalQuestion?.[1]) {
    return naturalQuestion[1].trim();
  }

  const targetMatch = query.match(/(?:to|for|of|update|replace|validate)\s+([A-Za-z_][\w.:/-]*)/i);
  if (targetMatch?.[1]) {
    return targetMatch[1].trim();
  }

  const symbolLike = query.match(/\b([A-Z][A-Za-z0-9_:.]+)\b/);
  if (symbolLike?.[1] && !["Apply", "Run", "Show", "Find", "Explain", "Analyze", "What"].includes(symbolLike[1])) {
    return symbolLike[1].trim();
  }

  return undefined;
}

/**
 * Converts a raw model JSON payload into an AgentPlan.
 *
 * Fully generic: validates the tool name against the live registry (when provided)
 * and passes arguments through without per-tool shaping. The model is responsible
 * for providing complete arguments since it receives the full tool manifest in the
 * system prompt. Minimal enrichment only: fill "name" and "query" when omitted.
 */
function normalizeToolPlan(
  payload: ModelPlanPayload,
  knownTools: ReadonlySet<string> | undefined,
  fallbackQuery: string,
  selectedText?: string,
): AgentPlan | undefined {
  if (payload.mode === "direct") {
    if (!payload.response || payload.response.trim().length === 0) {
      return undefined;
    }
    return {
      kind: "direct",
      response: payload.response.trim(),
      reasoning: payload.reasoning?.trim() || "The model answered directly.",
      source: "model",
    };
  }

  if (payload.mode !== "tool" || !payload.toolName) {
    return undefined;
  }

  // Reject tool names not registered in the current provider registry.
  // undefined knownTools = compat mode (no registry injected) — accept any name.
  if (knownTools !== undefined && knownTools.size > 0 && !knownTools.has(payload.toolName)) {
    return undefined;
  }

  const args: Record<string, unknown> = { ...(payload.arguments ?? {}) };

  // Minimal enrichment: fill "name" from context when the model omitted it
  if (!args["name"]) {
    const symbolName = extractLikelySymbolName(fallbackQuery, selectedText);
    if (symbolName) { args["name"] = symbolName; }
  }
  // Fill "query" when omitted (useful for memory-style tools)
  if (!args["query"]) {
    args["query"] = fallbackQuery.trim();
  }

  return {
    kind: "tool",
    toolName: payload.toolName,
    arguments: args,
    reasoning: payload.reasoning?.trim() || `Invoking ${payload.toolName} to answer the request.`,
    source: "model",
  };
}

export function extractFirstJsonObject(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) ?? trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return undefined;
}

export function createHeuristicPlan(
  query: string,
  selectedText?: string,
  mode: AgentRuntimeMode = "preview",
  activeFilePath?: string,
  knownTools?: ReadonlySet<string>,
  toolDefinitions?: ToolDefinition[],
): AgentPlan {
  const plan = computeHeuristicPlan(query, selectedText, mode, activeFilePath);
  // Registry guard: if the chosen tool is not registered, try keyword-based selection
  // from the registered tool definitions before falling back to a direct response.
  if (plan.kind === "tool" && knownTools !== undefined && !knownTools.has(plan.toolName)) {
    // Task 2: try keyword-based fallback using registered tool definitions.
    const keywordPlan = computeKeywordPlan(query, selectedText, mode, toolDefinitions, knownTools);
    if (keywordPlan) { return keywordPlan; }
    return {
      kind: "direct",
      response: knownTools.size === 0
        ? "No tool providers are currently registered. I can answer questions based on context only."
        : "The most relevant tool for this request is not currently available. I can answer based on context.",
      reasoning: `Planned tool (${plan.toolName}) is not registered in any active provider.`,
      source: "heuristic",
    };
  }
  return plan;
}

/**
 * Task 2: tool-agnostic keyword-based heuristic.
 * When the token-savior hardcoded tools are not registered, score all registered
 * tool definitions by keyword overlap with the query and pick the best match.
 */
function computeKeywordPlan(
  query: string,
  selectedText: string | undefined,
  mode: AgentRuntimeMode,
  toolDefinitions: ToolDefinition[] | undefined,
  knownTools: ReadonlySet<string>,
): AgentPlan | undefined {
  if (!toolDefinitions || toolDefinitions.length === 0) { return undefined; }
  const lower = query.toLowerCase();
  const words = lower.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) { return undefined; }

  // Only consider tools that are registered AND appropriate for the current mode.
  const candidates = toolDefinitions.filter((t) => {
    if (!knownTools.has(t.name)) { return false; }
    if (mode === "preview" && t.mutatesWorkspace) { return false; }
    return true;
  });
  if (candidates.length === 0) { return undefined; }

  let bestTool: ToolDefinition | undefined;
  let bestScore = 0;
  for (const t of candidates) {
    const haystack = `${t.name} ${t.category} ${t.description}`.toLowerCase();
    const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestTool = t; }
  }

  // Require at least one keyword match to avoid random tool selection.
  if (!bestTool || bestScore === 0) { return undefined; }

  const args: Record<string, unknown> = { query: query.trim() };
  const symbolName = extractLikelySymbolName(query, selectedText);
  if (symbolName) { args["name"] = symbolName; }

  return {
    kind: "tool",
    toolName: bestTool.name,
    arguments: args,
    reasoning: `Keyword match selected ${bestTool.name} (score: ${bestScore}) as the best available tool for this request.`,
    source: "heuristic",
  };
}

function computeHeuristicPlan(
  query: string,
  selectedText?: string,
  mode: AgentRuntimeMode = "preview",
  activeFilePath?: string,
): AgentPlan {
  const normalized = query.trim();
  const lower = normalized.toLowerCase();
  const symbolName = extractLikelySymbolName(normalized, selectedText);
  const actionId = extractLikelyProjectActionId(normalized);

  if (mode === "action") {
    if (
      selectedText?.trim()
      && symbolName
      && (
        lower.includes("apply")
        || lower.includes("replace")
        || lower.includes("rewrite")
        || lower.includes("update")
        || lower.includes("refactor")
      )
    ) {
      return {
        kind: "tool",
        toolName: "apply_symbol_change_and_validate",
        arguments: {
          symbol_name: symbolName,
          new_source: selectedText,
          ...(activeFilePath ? { file_path: activeFilePath } : {}),
          rollback_on_failure: true,
          include_output: true,
          compact: false,
        },
        reasoning: "The request asks for a symbol change, and the selected text provides the replacement source.",
        source: "heuristic",
      };
    }

    if (
      lower.includes("run impacted test")
      || lower.includes("run tests")
      || lower.includes("validate this")
      || lower.includes("validate the change")
      || lower.includes("test this")
    ) {
      return {
        kind: "tool",
        toolName: "run_impacted_tests",
        arguments: {
          ...(symbolName ? { symbol_names: [symbolName] } : activeFilePath ? { changed_files: [activeFilePath] } : {}),
          include_output: true,
          compact: false,
        },
        reasoning: "The request explicitly asks for validation, so impacted tests are the safest bounded execution tool.",
        source: "heuristic",
      };
    }

    if (actionId && (lower.includes("run") || lower.includes("execute"))) {
      return {
        kind: "tool",
        toolName: "run_project_action",
        arguments: {
          action_id: actionId,
          include_output: true,
        },
        reasoning: "The request names a project action directly, so it can be run through the bounded action executor.",
        source: "heuristic",
      };
    }

    if (
      lower.includes("discover project actions")
      || lower.includes("what actions can i run")
      || lower.includes("available actions")
    ) {
      return {
        kind: "tool",
        toolName: "discover_project_actions",
        arguments: {},
        reasoning: "The request is asking what executable actions exist for this project.",
        source: "heuristic",
      };
    }
  }

  if (
    lower.includes("project summary")
    || lower.includes("project overview")
    || lower.includes("what is this project")
    || lower.includes("summarize this project")
    || lower.includes("what is this repo")
  ) {
    return {
      kind: "tool",
      toolName: "get_project_summary",
      arguments: {},
      reasoning: "A project-level summary is the safest read-only way to answer this question.",
      source: "heuristic",
    };
  }

  if (
    symbolName
    && (
      lower.includes("impact")
      || lower.includes("what breaks")
      || lower.includes("blast radius")
      || lower.includes("who depends")
      || lower.includes("dependent")
    )
  ) {
    return {
      kind: "tool",
      toolName: "get_change_impact",
      arguments: {
        name: symbolName,
        max_direct: 20,
        max_transitive: 50,
      },
      reasoning: "This sounds like a change-impact question, so get_change_impact is the safest read-only tool.",
      source: "heuristic",
    };
  }

  if (
    symbolName
    && (
      lower.includes("dependency")
      || lower.includes("dependencies")
      || lower.includes("depends on")
      || lower.includes("what does")
      || lower.includes("uses")
      || lower.includes("calls")
    )
  ) {
    return {
      kind: "tool",
      toolName: "get_dependencies",
      arguments: {
        name: symbolName,
        max_results: 20,
        compress: false,
      },
      reasoning: "This sounds like a dependency question, so get_dependencies is the best read-only tool.",
      source: "heuristic",
    };
  }

  if (
    symbolName
    && (
      lower.includes("context")
      || lower.includes("analyze")
      || lower.includes("explain")
      || lower.includes("understand")
      || lower.includes("full context")
    )
  ) {
    return {
      kind: "tool",
      toolName: "get_full_context",
      arguments: {
        name: symbolName,
        depth: 2,
        mode: "compact",
        max_lines: 200,
      },
      reasoning: "This request asks for deeper understanding of a symbol, so get_full_context is the best safe tool.",
      source: "heuristic",
    };
  }

  if (
    lower.includes("memory")
    || lower.includes("remember")
    || lower.includes("history")
    || lower.includes("previous note")
  ) {
    return {
      kind: "tool",
      toolName: "memory_search",
      arguments: {
        query: normalized,
        limit: 10,
      },
      reasoning: "This request sounds like a memory lookup, so project memory search is the best read-only tool.",
      source: "heuristic",
    };
  }

  if (
    symbolName
    && (
      lower.includes("symbol")
      || lower.includes("function")
      || lower.includes("class")
      || lower.includes("method")
      || lower.includes("find")
      || lower.includes("locate")
      || lower.includes("where is")
      || lower.includes("show me")
    )
  ) {
    return {
      kind: "tool",
      toolName: "find_symbol",
      arguments: {
        name: symbolName,
        level: 1,
        hints: true,
        compress: false,
      },
      reasoning: "This looks like a symbol lookup, so find_symbol is the most direct safe tool.",
      source: "heuristic",
    };
  }

  return {
    kind: "direct",
    response: mode === "action"
      ? "I can help by applying selected text to a named symbol, running impacted tests, executing a named project action, or discovering project actions in action mode. Try asking for one of those explicitly."
      : "I can help with a project summary, symbol lookup, symbol dependencies, change impact, full symbol context, or project memory search in this preview mode. Try asking for one of those explicitly.",
    reasoning: mode === "action"
      ? "The request did not map clearly to a supported bounded action tool, so the action agent answered directly."
      : "The request did not map clearly to a supported read-only tool, so the preview agent answered directly.",
    source: "heuristic",
  };
}

export class AgentPlanner {
  public async plan(input: AgentPlannerInput): Promise<AgentPlan> {
    const mode = input.mode ?? "preview";
    const knownTools = input.knownToolNames;
    const fallbackPlan = createHeuristicPlan(input.query, input.selectedText, mode, input.activeFilePath, knownTools, input.toolDefinitions);
    if (!input.provider) {
      return fallbackPlan;
    }

    const toolManifest = input.toolManifest ?? "(no tools available — always return a direct response)";

    try {
      const response = await input.provider.complete({
        messages: [
          {
            role: "system",
            content: [
              "You are a planner for a VS Code coding agent.",
              "You must choose exactly one of these outcomes:",
              "1. direct response",
              "2. a tool call from the available tools list",
              "",
              "Available tools:",
              toolManifest,
              "",
              "Return strict JSON only with no prose.",
              "For a direct response, return:",
              '{"mode":"direct","response":"...","reasoning":"..."}',
              "For a tool response, return:",
              '{"mode":"tool","toolName":"<name>","arguments":{...},"reasoning":"..."}',
              knownTools !== undefined && knownTools.size === 0
                ? "No tools are available. You MUST return a direct response."
                : mode === "action"
                  ? "In action mode, mutating tools are allowed only when the user explicitly asked for an action."
                  : "Prefer read-only and memory tools. Avoid mutating tools unless explicitly asked.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Runtime mode: ${mode}`,
              `User query: ${input.query}`,
              `Selected text: ${input.selectedText ?? "<none>"}`,
              `Active file: ${input.activeFilePath ?? "<none>"}`,
              `Additional context:\n${input.context ?? "<none>"}`,
            ].join("\n"),
          },
        ],
        justification: "Plan the next safe action for the agent.",
      });

      const json = extractFirstJsonObject(response.text);
      if (!json) {
        return fallbackPlan;
      }

      const parsed = JSON.parse(json) as ModelPlanPayload;
      return normalizeToolPlan(parsed, knownTools, input.query, input.selectedText) ?? fallbackPlan;
    } catch {
      return fallbackPlan;
    }
  }

  public async planFollowUp(input: AgentPlannerFollowUpInput): Promise<AgentPlan | undefined> {
    const mode = input.mode ?? "preview";
    const knownTools = input.knownToolNames;
    const heuristic = createHeuristicFollowUpPlan(
      input.query,
      input.previousPlans,
      input.previousToolResults,
      input.selectedText,
      mode,
      input.activeFilePath,
      knownTools,
      input.toolDefinitions,
    );
    if (!input.provider) {
      return heuristic;
    }

    const toolManifest = input.toolManifest ?? "(no tools available — always return a direct response)";

    // Task 4: failure hint for the system prompt when the last tool result failed.
    const failureHint = input.previousResultFailed
      ? "IMPORTANT: The previous tool call returned a failure result. Choose a DIFFERENT tool or return a direct answer. Do NOT repeat the same tool."
      : undefined;

    try {
      const response = await input.provider.complete({
        messages: [
          {
            role: "system",
            content: [
              "You are a follow-up planner for a VS Code coding agent.",
              "You have already seen tool outputs from earlier steps.",
              "Decide whether the agent should stop with a direct answer or invoke exactly one more tool.",
              "",
              "Available tools:",
              toolManifest,
              "",
              ...(failureHint ? [failureHint, ""] : []),
              "Avoid repeating the same tool unless the previous result clearly failed.",
              "Return strict JSON only with no prose.",
              "Direct answer format:",
              '{"mode":"direct","response":"...","reasoning":"..."}',
              "Tool answer format:",
              '{"mode":"tool","toolName":"<name>","arguments":{...},"reasoning":"..."}',
              knownTools !== undefined && knownTools.size === 0
                ? "No tools are available. You MUST return a direct response."
                : mode === "action"
                  ? "Action-mode mutating tools are allowed when clearly requested."
                  : "Prefer read-only and memory tools only.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `User query: ${input.query}`,
              `Runtime mode: ${mode}`,
              `Selected text: ${input.selectedText ?? "<none>"}`,
              `Active file: ${input.activeFilePath ?? "<none>"}`,
              `Additional context:\n${input.context ?? "<none>"}`,
              "Completed steps:",
              ...input.previousPlans.map((plan, index) => {
                const result = input.previousToolResults[index];
                if (plan.kind === "direct") {
                  return `${index + 1}. direct => ${plan.response}`;
                }

                return [
                  `${index + 1}. tool => ${plan.toolName}`,
                  `arguments: ${JSON.stringify(plan.arguments)}`,
                  `result: ${result ? formatToolResult(result) : "<none>"}`,
                ].join("\n");
              }),
            ].join("\n\n"),
          },
        ],
        justification: "Decide the next bounded safe step for the agent.",
      });

      const json = extractFirstJsonObject(response.text);
      if (!json) {
        return heuristic;
      }

      const parsed = JSON.parse(json) as ModelPlanPayload;
      return normalizeToolPlan(parsed, knownTools, input.query, input.selectedText) ?? heuristic;
    } catch {
      return heuristic;
    }
  }
}

function createHeuristicFollowUpPlan(
  query: string,
  previousPlans: AgentPlan[],
  previousToolResults: ToolResult[],
  selectedText?: string,
  mode: AgentRuntimeMode = "preview",
  activeFilePath?: string,
  knownTools?: ReadonlySet<string>,
  toolDefinitions?: ToolDefinition[],
): AgentPlan | undefined {
  const plan = computeHeuristicFollowUpPlan(query, previousPlans, previousToolResults, selectedText, mode, activeFilePath);
  // Registry guard: skip follow-up tool steps for tools that are not registered.
  // Task 2: try keyword-based selection before giving up.
  if (plan && plan.kind === "tool" && knownTools !== undefined && !knownTools.has(plan.toolName)) {
    const keywordPlan = computeKeywordPlan(query, selectedText, mode, toolDefinitions, knownTools);
    return keywordPlan ?? undefined;
  }
  return plan;
}

function computeHeuristicFollowUpPlan(
  query: string,
  previousPlans: AgentPlan[],
  previousToolResults: ToolResult[],
  selectedText?: string,
  mode: AgentRuntimeMode = "preview",
  activeFilePath?: string,
): AgentPlan | undefined {
  const lower = query.trim().toLowerCase();
  const symbolName = extractLikelySymbolName(query, selectedText);
  const actionId = extractLikelyProjectActionId(query);
  const requestedApply = lower.includes("apply") || lower.includes("replace") || lower.includes("rewrite") || lower.includes("update") || lower.includes("refactor");
  const requestedValidation = lower.includes("validate") || lower.includes("test");
  const usedTools = new Set(previousPlans.filter((plan) => plan.kind === "tool").map((plan) => plan.toolName));
  const lastResult = previousToolResults.at(-1);

  if (lastResult && !lastResult.ok) {
    return {
      kind: "direct",
      response: `The last tool returned an error: ${formatToolResult(lastResult)}`,
      reasoning: "A failing read-only tool result is better surfaced directly than extended with more tool calls.",
      source: "heuristic",
    };
  }

  if (mode === "action") {
    if (usedTools.has("run_impacted_tests")) {
      return undefined;
    }

    if (usedTools.has("discover_project_actions") && actionId && !usedTools.has("run_project_action")) {
      return {
        kind: "tool",
        toolName: "run_project_action",
        arguments: {
          action_id: actionId,
          include_output: true,
        },
        reasoning: "After discovering available actions, the next bounded step is to run the requested action.",
        source: "heuristic",
      };
    }

    if (
      selectedText?.trim()
      && symbolName
      && !usedTools.has("apply_symbol_change_and_validate")
      && usedTools.has("find_symbol")
      && requestedApply
    ) {
      return {
        kind: "tool",
        toolName: "apply_symbol_change_and_validate",
        arguments: {
          symbol_name: symbolName,
          new_source: selectedText,
          ...(activeFilePath ? { file_path: activeFilePath } : {}),
          rollback_on_failure: true,
          include_output: true,
          compact: false,
        },
        reasoning: "After locating the symbol, the next bounded action step is to apply the requested change with validation.",
        source: "heuristic",
      };
    }

    if (
      !usedTools.has("run_impacted_tests")
      && (
        (usedTools.has("apply_symbol_change_and_validate") && requestedValidation)
        || (usedTools.has("run_project_action") && requestedValidation)
      )
    ) {
      return {
        kind: "tool",
        toolName: "run_impacted_tests",
        arguments: {
          ...(symbolName ? { symbol_names: [symbolName] } : activeFilePath ? { changed_files: [activeFilePath] } : {}),
          include_output: true,
          compact: false,
        },
        reasoning: "The approved action workflow should continue with targeted validation before stopping.",
        source: "heuristic",
      };
    }

    if (usedTools.has("apply_symbol_change_and_validate") || usedTools.has("run_project_action")) {
      return undefined;
    }
  }

  if (
    symbolName
    && !usedTools.has("get_dependencies")
    && (lower.includes("dependency") || lower.includes("dependencies") || lower.includes("depends on") || lower.includes("uses") || lower.includes("calls"))
  ) {
    return {
      kind: "tool",
      toolName: "get_dependencies",
      arguments: {
        name: symbolName,
        max_results: 20,
        compress: false,
      },
      reasoning: "A dependency follow-up can add useful read-only detail before stopping.",
      source: "heuristic",
    };
  }

  if (
    symbolName
    && !usedTools.has("get_full_context")
    && usedTools.has("find_symbol")
    && (lower.includes("context") || lower.includes("analyze") || lower.includes("explain") || lower.includes("understand"))
  ) {
    return {
      kind: "tool",
      toolName: "get_full_context",
      arguments: {
        name: symbolName,
        depth: 2,
        mode: "compact",
        max_lines: 200,
      },
      reasoning: "After locating the symbol, the next best read-only step is to pull its full context.",
      source: "heuristic",
    };
  }

  if (
    symbolName
    && !usedTools.has("get_change_impact")
    && (lower.includes("impact") || lower.includes("what breaks") || lower.includes("blast radius") || lower.includes("dependent"))
  ) {
    return {
      kind: "tool",
      toolName: "get_change_impact",
      arguments: {
        name: symbolName,
        max_direct: 20,
        max_transitive: 50,
      },
      reasoning: "A change-impact follow-up can answer the blast-radius part of the request.",
      source: "heuristic",
    };
  }

  return undefined;
}
