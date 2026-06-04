import type { AgentMemoryContext } from "./memoryBridge";
import { budgetContextBlock, budgetSelectedText } from "./contextBudget";

export interface AgentContextBuildInput {
  selectedText?: string;
  activeFilePath?: string;
  workspaceContextBundle?: string;
  memoryContext?: AgentMemoryContext;
  maxContextChars?: number;
}

export function buildAgentContext(input: AgentContextBuildInput): string | undefined {
  const sections: string[] = [];

  if (input.activeFilePath) {
    sections.push(`Active file: ${input.activeFilePath}`);
  }

  const selectedText = budgetSelectedText(input.selectedText);
  if (selectedText) {
    sections.push(["Selected text:", selectedText].join("\n"));
  }

  if (input.workspaceContextBundle?.trim()) {
    sections.push(input.workspaceContextBundle.trim());
  } else if (input.memoryContext?.recentRuns.length) {
    sections.push([
      "Recent preview runs:",
      ...input.memoryContext.recentRuns.map((line) => `- ${line}`),
    ].join("\n"));
  }

  if (input.memoryContext?.sessionHistory) {
    sections.push(["Prior session history:", input.memoryContext.sessionHistory].join("\n"));
  }

  if (!input.workspaceContextBundle?.trim() && input.memoryContext?.workspaceMemory) {
    sections.push(["Workspace memory summary:", input.memoryContext.workspaceMemory].join("\n"));
  }

  if (input.memoryContext?.projectMemory) {
    sections.push(["Relevant project memory:", input.memoryContext.projectMemory].join("\n"));
  }

  if (sections.length === 0) {
    return undefined;
  }

  return budgetContextBlock(sections.join("\n\n"), input.maxContextChars);
}
