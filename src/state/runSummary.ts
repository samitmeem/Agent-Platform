/**
 * FIX-10: Compact run summary for Memento persistence.
 *
 * Old code stored the full AgentPreviewResult (all tool payloads, all trace
 * entries, full plans array) inside every StoredPreviewRun written to
 * vscode.Memento. On large workspaces this hit Memento size limits silently.
 *
 * New code: WorkspaceStore persists only a CompactRunSummary. The full
 * AgentPreviewResult is kept only in the in-memory SessionStore and is
 * discarded on extension-host restart.
 */

export interface CompactRunSummary {
  id: string;
  query: string;
  answer: string;
  createdAt: string;
  startedAt?: string;
  durationMs?: number;
  source?: "chat" | "command";
  outcome?: "completed" | "failed" | "cancelled";
  activeFilePath?: string;
  providerKind?: string;
  toolSequence?: string[];
  memoryState?: string;
}

export function toCompactSummary(run: {
  id: string;
  query: string;
  answer: string;
  createdAt: string;
  startedAt?: string;
  durationMs?: number;
  source?: "chat" | "command";
  outcome?: "completed" | "failed" | "cancelled";
  activeFilePath?: string;
  result: {
    providerKind?: string;
    plans?: Array<{ kind: string; toolName?: string }>;
    plan: { kind: string; toolName?: string };
  };
  memoryStatus?: { state: string };
}): CompactRunSummary {
  const plans = run.result.plans ?? [run.result.plan];
  const toolSequence = plans
    .filter((p): p is { kind: "tool"; toolName: string } =>
      p.kind === "tool" && typeof p.toolName === "string",
    )
    .map((p) => p.toolName);

  return {
    id: run.id,
    query: run.query.slice(0, 200),
    answer: run.answer.slice(0, 500),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    source: run.source,
    outcome: run.outcome,
    activeFilePath: run.activeFilePath,
    providerKind: run.result.providerKind,
    toolSequence: toolSequence.length > 0 ? toolSequence : undefined,
    memoryState: run.memoryStatus?.state,
  };
}
