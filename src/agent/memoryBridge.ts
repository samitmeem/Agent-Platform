import { formatToolResult, type ServiceToolResult } from "../backend/protocol";
import type { SessionStore } from "../state/sessionStore";

export interface AgentMemoryToolExecutor {
  invokeTool(
    workspaceRoot: string,
    name: string,
    argumentsPayload: Record<string, unknown>,
  ): Promise<ServiceToolResult>;
}

export interface AgentMemoryBridgeDependencies {
  workspaceRoot: string;
  toolExecutor: AgentMemoryToolExecutor;
  sessionStore: SessionStore;
}

export interface AgentMemoryContext {
  recentRuns: string[];
  sessionHistory?: string;
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

    const sessionHistoryResult = await this.tryInvokeTool("memory_session_history", { limit: 2 });
    const projectMemoryResult = shouldSearchProjectMemory(query)
      ? await this.tryInvokeTool("memory_search", { query, limit: 3 })
      : undefined;

    return {
      recentRuns,
      sessionHistory: this.extractContextText(sessionHistoryResult, 800),
      projectMemory: this.extractContextText(projectMemoryResult, 1000),
    };
  }

  private async tryInvokeTool(
    name: string,
    argumentsPayload: Record<string, unknown>,
  ): Promise<ServiceToolResult | undefined> {
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
    result: ServiceToolResult | undefined,
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
}
