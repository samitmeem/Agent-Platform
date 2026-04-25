import type { ModelProvider } from "../providers/base";
import { formatToolResult, type ServiceToolResult } from "../backend/protocol";

import type { AgentPlan, AgentRuntimeMode, AgentToolName } from "./types";

export interface AgentPlannerInput {
  query: string;
  selectedText?: string;
  activeFilePath?: string;
  mode?: AgentRuntimeMode;
  provider?: ModelProvider;
  context?: string;
}

export interface AgentPlannerFollowUpInput extends AgentPlannerInput {
  previousPlans: AgentPlan[];
  previousToolResults: ServiceToolResult[];
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

function normalizeToolPlan(
  payload: ModelPlanPayload,
  fallbackQuery: string,
  selectedText?: string,
  activeFilePath?: string,
  mode: AgentRuntimeMode = "preview",
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

  if (payload.toolName === "get_project_summary") {
    return {
      kind: "tool",
      toolName: "get_project_summary",
      arguments: {},
      reasoning: payload.reasoning?.trim() || "A project summary should answer the request.",
      source: "model",
    };
  }

  if (payload.toolName === "memory_search") {
    const query = typeof payload.arguments?.query === "string" && payload.arguments.query.trim().length > 0
      ? payload.arguments.query.trim()
      : fallbackQuery;
    const limit = typeof payload.arguments?.limit === "number" ? payload.arguments.limit : 10;
    return {
      kind: "tool",
      toolName: "memory_search",
      arguments: { query, limit },
      reasoning: payload.reasoning?.trim() || "Searching project memory should answer the request.",
      source: "model",
    };
  }

  if (payload.toolName === "find_symbol") {
    const name = typeof payload.arguments?.name === "string" && payload.arguments.name.trim().length > 0
      ? payload.arguments.name.trim()
      : extractLikelySymbolName(fallbackQuery, selectedText);
    if (!name) {
      return undefined;
    }

    return {
      kind: "tool",
      toolName: "find_symbol",
      arguments: {
        name,
        level: 1,
        hints: true,
        compress: false,
      },
      reasoning: payload.reasoning?.trim() || "Locating the symbol should answer the request.",
      source: "model",
    };
  }

  if (payload.toolName === "get_dependencies") {
    const name = typeof payload.arguments?.name === "string" && payload.arguments.name.trim().length > 0
      ? payload.arguments.name.trim()
      : extractLikelySymbolName(fallbackQuery, selectedText);
    if (!name) {
      return undefined;
    }

    return {
      kind: "tool",
      toolName: "get_dependencies",
      arguments: {
        name,
        max_results: 20,
        compress: false,
      },
      reasoning: payload.reasoning?.trim() || "Inspecting symbol dependencies should answer the request.",
      source: "model",
    };
  }

  if (payload.toolName === "get_change_impact") {
    const name = typeof payload.arguments?.name === "string" && payload.arguments.name.trim().length > 0
      ? payload.arguments.name.trim()
      : extractLikelySymbolName(fallbackQuery, selectedText);
    if (!name) {
      return undefined;
    }

    return {
      kind: "tool",
      toolName: "get_change_impact",
      arguments: {
        name,
        max_direct: 20,
        max_transitive: 50,
      },
      reasoning: payload.reasoning?.trim() || "Change-impact analysis should answer the request.",
      source: "model",
    };
  }

  if (payload.toolName === "get_full_context") {
    const name = typeof payload.arguments?.name === "string" && payload.arguments.name.trim().length > 0
      ? payload.arguments.name.trim()
      : extractLikelySymbolName(fallbackQuery, selectedText);
    if (!name) {
      return undefined;
    }

    return {
      kind: "tool",
      toolName: "get_full_context",
      arguments: {
        name,
        depth: 2,
        mode: "compact",
        max_lines: 200,
      },
      reasoning: payload.reasoning?.trim() || "A full symbol context bundle should answer the request.",
      source: "model",
    };
  }

  if (mode === "action" && payload.toolName === "discover_project_actions") {
    return {
      kind: "tool",
      toolName: "discover_project_actions",
      arguments: {},
      reasoning: payload.reasoning?.trim() || "Discovering project actions is the safest first step for action-mode execution.",
      source: "model",
    };
  }

  if (mode === "action" && payload.toolName === "run_project_action") {
    const actionId = typeof payload.arguments?.action_id === "string" && payload.arguments.action_id.trim().length > 0
      ? payload.arguments.action_id.trim()
      : extractLikelyProjectActionId(fallbackQuery);
    if (!actionId) {
      return undefined;
    }

    return {
      kind: "tool",
      toolName: "run_project_action",
      arguments: {
        action_id: actionId,
        include_output: true,
      },
      reasoning: payload.reasoning?.trim() || "Running the selected project action best satisfies the request.",
      source: "model",
    };
  }

  if (mode === "action" && payload.toolName === "run_impacted_tests") {
    const symbolNames = Array.isArray(payload.arguments?.symbol_names)
      ? payload.arguments.symbol_names
      : undefined;
    const name = typeof symbolNames?.[0] === "string"
      ? String(symbolNames[0]).trim()
      : extractLikelySymbolName(fallbackQuery, selectedText);
    return {
      kind: "tool",
      toolName: "run_impacted_tests",
      arguments: {
        ...(name ? { symbol_names: [name] } : activeFilePath ? { changed_files: [activeFilePath] } : {}),
        include_output: true,
        compact: false,
      },
      reasoning: payload.reasoning?.trim() || "Running impacted tests is the safest bounded way to validate the requested change.",
      source: "model",
    };
  }

  if (mode === "action" && payload.toolName === "apply_symbol_change_and_validate") {
    const symbolName = typeof payload.arguments?.symbol_name === "string" && payload.arguments.symbol_name.trim().length > 0
      ? payload.arguments.symbol_name.trim()
      : extractLikelySymbolName(fallbackQuery);
    const newSource = typeof payload.arguments?.new_source === "string" && payload.arguments.new_source.trim().length > 0
      ? payload.arguments.new_source
      : selectedText?.trim();
    if (!symbolName || !newSource) {
      return undefined;
    }

    return {
      kind: "tool",
      toolName: "apply_symbol_change_and_validate",
      arguments: {
        symbol_name: symbolName,
        new_source: newSource,
        ...(activeFilePath ? { file_path: activeFilePath } : {}),
        rollback_on_failure: true,
        include_output: true,
        compact: false,
      },
      reasoning: payload.reasoning?.trim() || "Applying the provided symbol change with validation best satisfies the request.",
      source: "model",
    };
  }

  return undefined;
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
    const fallbackPlan = createHeuristicPlan(input.query, input.selectedText, mode, input.activeFilePath);
    if (!input.provider) {
      return fallbackPlan;
    }

    try {
      const response = await input.provider.complete({
        messages: [
          {
            role: "system",
            content: [
              "You are a planner for a read-only VS Code coding agent.",
              "You must choose exactly one of these outcomes:",
              "1. direct response",
              "2. tool call to get_project_summary",
              "3. tool call to find_symbol",
              "4. tool call to memory_search",
              "5. tool call to get_dependencies",
              "6. tool call to get_change_impact",
              "7. tool call to get_full_context",
              ...(mode === "action"
                ? [
                  "8. tool call to discover_project_actions",
                  "9. tool call to run_project_action",
                  "10. tool call to run_impacted_tests",
                  "11. tool call to apply_symbol_change_and_validate",
                ]
                : []),
              "Return strict JSON only with no prose.",
              "For a direct response, return:",
              '{"mode":"direct","response":"...","reasoning":"..."}',
              "For a tool response, return:",
              '{"mode":"tool","toolName":"find_symbol","arguments":{"name":"..."},"reasoning":"..."}',
              mode === "action"
                ? "In action mode, only choose mutating tools when the user clearly asked for an action."
                : "Never choose tools outside the allowed set.",
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
        justification: "Plan the next safe read-only action for the Token Savior preview agent.",
      });

      const json = extractFirstJsonObject(response.text);
      if (!json) {
        return fallbackPlan;
      }

      const parsed = JSON.parse(json) as ModelPlanPayload;
      return normalizeToolPlan(parsed, input.query, input.selectedText, input.activeFilePath, mode) ?? fallbackPlan;
    } catch {
      return fallbackPlan;
    }
  }

  public async planFollowUp(input: AgentPlannerFollowUpInput): Promise<AgentPlan | undefined> {
    const mode = input.mode ?? "preview";
    const heuristic = createHeuristicFollowUpPlan(
      input.query,
      input.previousPlans,
      input.previousToolResults,
      input.selectedText,
      mode,
      input.activeFilePath,
    );
    if (!input.provider) {
      return heuristic;
    }

    try {
      const response = await input.provider.complete({
        messages: [
          {
            role: "system",
            content: [
              "You are a follow-up planner for a read-only VS Code coding agent.",
              "You have already seen tool outputs from earlier steps.",
              "Decide whether the agent should stop with a direct answer or invoke exactly one more safe read-only tool.",
              "Allowed tools: get_project_summary, find_symbol, memory_search, get_dependencies, get_change_impact, get_full_context.",
              ...(mode === "action"
                ? [
                  "Action-mode tools also allowed when clearly requested: discover_project_actions, run_project_action, run_impacted_tests, apply_symbol_change_and_validate.",
                ]
                : []),
              "Avoid repeating the same tool unless the previous result clearly failed.",
              "Return strict JSON only with no prose.",
              "Direct answer format:",
              '{"mode":"direct","response":"...","reasoning":"..."}',
              "Tool answer format:",
              '{"mode":"tool","toolName":"get_dependencies","arguments":{"name":"..."},"reasoning":"..."}',
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
        justification: "Decide the next bounded safe read-only step for the Token Savior agent.",
      });

      const json = extractFirstJsonObject(response.text);
      if (!json) {
        return heuristic;
      }

      const parsed = JSON.parse(json) as ModelPlanPayload;
      return normalizeToolPlan(parsed, input.query, input.selectedText, input.activeFilePath, mode) ?? heuristic;
    } catch {
      return heuristic;
    }
  }
}

function createHeuristicFollowUpPlan(
  query: string,
  previousPlans: AgentPlan[],
  previousToolResults: ServiceToolResult[],
  selectedText?: string,
  mode: AgentRuntimeMode = "preview",
  activeFilePath?: string,
): AgentPlan | undefined {
  const lower = query.trim().toLowerCase();
  const symbolName = extractLikelySymbolName(query, selectedText);
  const actionId = extractLikelyProjectActionId(query);
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
    if (
      usedTools.has("run_impacted_tests")
      || usedTools.has("apply_symbol_change_and_validate")
      || usedTools.has("run_project_action")
    ) {
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
      && (lower.includes("apply") || lower.includes("replace") || lower.includes("rewrite") || lower.includes("update") || lower.includes("refactor"))
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
