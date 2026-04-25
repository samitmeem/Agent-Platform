import type { AgentMemoryContext } from "./memoryBridge";

export interface AgentContextBuildInput {
  selectedText?: string;
  activeFilePath?: string;
  memoryContext?: AgentMemoryContext;
}

export function buildAgentContext(input: AgentContextBuildInput): string | undefined {
  const sections: string[] = [];

  if (input.activeFilePath) {
    sections.push(`Active file: ${input.activeFilePath}`);
  }

  if (input.selectedText?.trim()) {
    sections.push(["Selected text:", input.selectedText.trim()].join("\n"));
  }

  if (input.memoryContext?.recentRuns.length) {
    sections.push([
      "Recent preview runs:",
      ...input.memoryContext.recentRuns.map((line) => `- ${line}`),
    ].join("\n"));
  }

  if (input.memoryContext?.sessionHistory) {
    sections.push(["Prior session history:", input.memoryContext.sessionHistory].join("\n"));
  }

  if (input.memoryContext?.projectMemory) {
    sections.push(["Relevant project memory:", input.memoryContext.projectMemory].join("\n"));
  }

  if (sections.length === 0) {
    return undefined;
  }

  return sections.join("\n\n");
}
