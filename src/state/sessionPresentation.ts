import { formatToolResult } from "../backend/protocol";
import { formatTraceEntries } from "../agent/trace";

import type { StoredPreviewRun } from "./sessionStore";

export interface PreviewRunListItem {
  label: string;
  description: string;
  detail: string;
  runId: string;
}

export function formatStoredPreviewRunBody(run: StoredPreviewRun | undefined): string {
  if (!run) {
    return "No preview agent runs have been recorded in this session yet.";
  }

  const sections = [
    `Run ID: ${run.id}`,
    `Created: ${run.createdAt}`,
    ...(run.startedAt ? [`Started: ${run.startedAt}`] : []),
    ...(typeof run.durationMs === "number" ? [`Duration: ${run.durationMs} ms`] : []),
    `Source: ${run.source ?? "command"}`,
    `Outcome: ${run.outcome ?? "completed"}`,
    `Query: ${run.query}`,
    `Plan source: ${run.result.plan.source}`,
    `Plan reasoning: ${run.result.plan.reasoning}`,
    `Provider: ${run.result.providerKind ?? "none"}`,
  ];

  if (run.activeFilePath) {
    sections.push(`Active file: ${run.activeFilePath}`);
  }

  if (run.memoryStatus) {
    const savedAt = run.memoryStatus.savedAt ? ` @ ${run.memoryStatus.savedAt}` : "";
    sections.push(`Memory: ${run.memoryStatus.state}${savedAt} — ${run.memoryStatus.reason}`);
  }

  if (run.result.plan.kind === "tool") {
    sections.push(
      `Tool: ${run.result.plan.toolName}`,
      `Arguments: ${JSON.stringify(run.result.plan.arguments)}`,
    );
  }

  if ((run.result.plans?.length ?? 0) > 1) {
    sections.push(`Tool sequence: ${run.result.plans?.filter((plan) => plan.kind === "tool").map((plan) => plan.toolName).join(" -> ")}`);
  }

  sections.push("", "Answer:", run.answer, "", "Trace:", formatTraceEntries(run.result.trace));

  if (run.result.toolResult) {
    sections.push("", "Raw tool result:", formatToolResult(run.result.toolResult));
  }

  return sections.join("\n");
}

export function toPreviewRunListItem(run: StoredPreviewRun): PreviewRunListItem {
  const query = run.query.replace(/\s+/g, " ").trim();
  const answer = run.answer.replace(/\s+/g, " ").trim();
  const detail = answer.length > 120 ? `${answer.slice(0, 119)}…` : answer;

  return {
    label: query.length > 80 ? `${query.slice(0, 79)}…` : query,
    description: `${run.createdAt} · ${run.result.plan.kind} · ${run.outcome ?? "completed"} · ${run.result.providerKind ?? "no provider"}${run.memoryStatus ? ` · memory=${run.memoryStatus.state}` : ""}`,
    detail,
    runId: run.id,
  };
}