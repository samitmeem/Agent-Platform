import { formatToolResult, type MemoryCapability, type ToolResult } from "../tools/interface";
import type { SessionStore } from "../state/sessionStore";

export interface AgentMemoryToolExecutor {
  invokeTool(
    workspaceRoot: string,
    name: string,
    argumentsPayload: Record<string, unknown>,
  ): Promise<ToolResult>;
}

export interface AgentMemoryBridgeDependencies {
  workspaceRoot: string;
  toolExecutor: AgentMemoryToolExecutor;
  sessionStore: SessionStore;
  /** Provided by the registered tool provider; omit to disable memory tool calls. */
  memoryCapability?: MemoryCapability;
  /** Extension-owned compact project memory summary for backend-optional context injection. */
  workspaceMemorySummary?: string;
}

export interface AgentMemoryContext {
  recentRuns: string[];
  sessionHistory?: string;
  workspaceMemory?: string;
  projectMemory?: string;
}

function toCompactSingleLine(text: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function shouldSearchProjectMemory(query: string): boolean {
  const lower = query.toLowerCase();
  return lower.includes("memory")
    || lower.includes("history")
    || lower.includes("decision")
    || lower.includes("context")
    || lower.includes("previous")
    || lower.includes("why")
    || query.trim().split(/\s+/).length >= 5;
}

export class AgentMemoryBridge {
  public constructor(private readonly dependencies: AgentMemoryBridgeDependencies) {}

  public async buildContext(query: string): Promise<AgentMemoryContext> {
    const recentRuns = this.dependencies.sessionStore
      .listPreviewRuns(3)
      .map((run) => `${toCompactSingleLine(run.query, 90)} => ${toCompactSingleLine(run.answer, 120)}`);

    const capability = this.dependencies.memoryCapability;
    const workspaceMemory = this.extractInlineText(this.dependencies.workspaceMemorySummary, 1_200);
    const sessionHistoryResult = capability
      ? await this.tryInvokeTool(capability.sessionHistoryToolName, { limit: 2 })
      : undefined;
    const projectMemoryResult = (capability && shouldSearchProjectMemory(query))
      ? await this.tryInvokeTool(capability.searchToolName, { query, limit: 3 })
      : undefined;

    return {
      recentRuns,
      sessionHistory: this.extractContextText(sessionHistoryResult, 800),
      workspaceMemory,
      projectMemory: this.extractContextText(projectMemoryResult, 1000),
    };
  }

  private async tryInvokeTool(
    name: string,
    argumentsPayload: Record<string, unknown>,
  ): Promise<ToolResult | undefined> {
    try {
      return await this.dependencies.toolExecutor.invokeTool(
        this.dependencies.workspaceRoot,
        name,
        argumentsPayload,
      );
    } catch {
      return undefined;
    }
  }

  private extractContextText(
    result: ToolResult | undefined,
    maxLength: number,
  ): string | undefined {
    if (!result?.ok) {
      return undefined;
    }

    const text = formatToolResult(result).trim();
    if (!text || text.endsWith("returned no content.")) {
      return undefined;
    }

    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
  }

  private extractInlineText(text: string | undefined, maxLength: number): string | undefined {
    const normalized = text?.trim();
    if (!normalized) {
      return undefined;
    }

    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
  }
}
