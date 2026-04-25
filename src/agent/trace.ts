export type AgentTracePhase = "context" | "provider" | "plan" | "tool" | "control" | "answer";

export interface AgentTraceEntry {
  step: number;
  phase: AgentTracePhase;
  message: string;
  data?: Record<string, unknown>;
}

export function traceEntry(
  step: number,
  phase: AgentTracePhase,
  message: string,
  data?: Record<string, unknown>,
): AgentTraceEntry {
  return {
    step,
    phase,
    message,
    data,
  };
}

export function formatTraceEntries(entries: readonly AgentTraceEntry[]): string {
  if (entries.length === 0) {
    return "<no trace entries>";
  }

  return entries.map((entry) => {
    const suffix = entry.data && Object.keys(entry.data).length > 0
      ? ` ${JSON.stringify(entry.data)}`
      : "";
    return `${entry.step}. [${entry.phase}] ${entry.message}${suffix}`;
  }).join("\n");
}
