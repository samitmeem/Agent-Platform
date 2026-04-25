import { formatToolResult, type ToolResult } from "../tools/interface";
import type { StoredPreviewRun } from "../state/sessionStore";

export interface MemorySavePayload extends Record<string, unknown> {
  type: string;
  title: string;
  content: string;
  why: string;
  how_to_apply: string;
  tags: string[];
  importance: number;
  context?: string;
  file_path?: string;
  narrative?: string;
  facts?: string;
  concepts?: string;
}

export interface PreviewRunAutoSaveDecision {
  shouldSave: boolean;
  reason: string;
}

function compact(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function getToolSequence(run: StoredPreviewRun): string[] {
  const steps = run.result.plans?.filter((plan) => plan.kind === "tool").map((plan) => plan.toolName);
  if (steps && steps.length > 0) {
    return steps;
  }

  return run.result.plan.kind === "tool" ? [run.result.plan.toolName] : [];
}

function getToolResults(run: StoredPreviewRun): ToolResult[] {
  if (run.result.toolResults && run.result.toolResults.length > 0) {
    return [...run.result.toolResults];
  }

  return run.result.toolResult ? [run.result.toolResult] : [];
}

export function evaluatePreviewRunForAutoSave(run: StoredPreviewRun): PreviewRunAutoSaveDecision {
  const toolSequence = getToolSequence(run);
  if (toolSequence.length === 0) {
    return {
      shouldSave: false,
      reason: "Skipped direct-only run to avoid saving generic conversational replies.",
    };
  }

  if (toolSequence.length >= 2) {
    return {
      shouldSave: true,
      reason: "Auto-saved multi-step tool investigation for future workspace reuse.",
    };
  }

  const toolResults = getToolResults(run);
  if (!toolResults.some((result) => result.ok)) {
    return {
      shouldSave: false,
      reason: "Skipped single-step run because it did not produce a successful tool result.",
    };
  }

  if (compact(run.answer, 1000).length < 120) {
    return {
      shouldSave: false,
      reason: "Skipped short single-step run to keep project memory focused on higher-value findings.",
    };
  }

  return {
    shouldSave: true,
    reason: "Auto-saved substantial tool-backed run for future workspace reuse.",
  };
}

export function buildMemoryPayloadFromRun(run: StoredPreviewRun): MemorySavePayload {
  const toolSequence = getToolSequence(run);
  const toolResults = getToolResults(run);
  const keyFindings = toolResults.slice(0, 3).map((result, index) => (
    `- Step ${index + 1} (${result.name}${result.ok ? "" : ", failed"}): ${compact(formatToolResult(result), 240)}`
  ));
  const content = [
    `Query: ${run.query}`,
    `Answer: ${run.answer}`,
    `Source: ${run.source ?? "command"}`,
    `Provider: ${run.result.providerKind ?? "none"}`,
    `Tool sequence: ${toolSequence.length > 0 ? toolSequence.join(" -> ") : "direct"}`,
    ...(run.activeFilePath ? [`Active file: ${run.activeFilePath}`] : []),
    ...(keyFindings.length > 0 ? ["Key findings:", ...keyFindings] : []),
  ].join("\n");
  const narrative = compact([
    `The extension handled the request \"${run.query}\" via ${run.source ?? "command"} mode.`,
    toolSequence.length > 0
      ? `It used the tool sequence ${toolSequence.join(" -> ")} and concluded: ${run.answer}`
      : `It answered directly with: ${run.answer}`,
  ].join(" "), 500);
  const facts = JSON.stringify([
    `query:${compact(run.query, 140)}`,
    `source:${run.source ?? "command"}`,
    `provider:${run.result.providerKind ?? "none"}`,
    `toolCount:${toolSequence.length}`,
    ...toolSequence.map((tool) => `tool:${tool}`),
  ]);
  const tags = Array.from(new Set([
    "agent-run",
    "extension",
    run.source ?? "command",
    ...(toolSequence.length >= 2 ? ["multi-step"] : toolSequence.length === 1 ? ["tool-backed"] : ["direct"]),
    ...toolSequence.slice(0, 4),
  ]));

  return {
    type: toolResults.some((result) => !result.ok) ? "warning" : "decision",
    title: compact(`Agent ${run.source ?? "command"} run: ${run.query}`, 100),
    content,
    why: toolSequence.length >= 2
      ? "Preserve a multi-step agent investigation that combined multiple backend findings."
      : "Preserve a high-value tool-backed agent result for future workspace sessions.",
    how_to_apply: "Review this saved run when a similar symbol, dependency, impact, or project question appears again.",
    tags,
    importance: Math.min(8, 5 + toolSequence.length + (toolResults.some((result) => !result.ok) ? 1 : 0)),
    context: `created_at=${run.createdAt}; memory_state=${run.memoryStatus?.state ?? "pending"}`,
    file_path: run.activeFilePath,
    narrative,
    facts,
    concepts: JSON.stringify(Array.from(new Set(toolSequence.slice(0, 4)))),
  };
}

export function buildMemoryPayloadFromToolResult(title: string, result: ToolResult): MemorySavePayload {
  return {
    type: result.ok ? "note" : "warning",
    title: compact(title, 100),
    content: result.content.join("\n\n"),
    why: "Preserve the outcome of an approved workflow action.",
    how_to_apply: "Review this saved result before repeating the same workflow.",
    tags: ["workflow", result.name],
    importance: result.ok ? 5 : 7,
  };
}
