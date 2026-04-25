/**
 * FIX-6: Dynamic tool registry.
 *
 * Old code: AgentToolName was a static TypeScript union of 10 tools.
 * Adding a tool to the Python backend had zero effect on agent planning.
 *
 * New code: The registry is populated at session start by calling
 * capabilities.list on the backend. The planner receives the live list and
 * includes it in the system prompt so the model can choose any available tool.
 */

import type { BackendGateway } from "../backend/gateway";

export interface BackendCapability {
  name: string;
  category: string;
  description: string;
}

export class ToolRegistry {
  private capabilities: BackendCapability[] = [];
  private loadedAt: number | undefined;

  /** Reload if stale (older than 5 minutes) or never loaded. */
  private isStale(): boolean {
    return this.loadedAt === undefined || Date.now() - this.loadedAt > 5 * 60_000;
  }

  public async refresh(gateway: BackendGateway, workspaceRoot: string): Promise<void> {
    if (!this.isStale()) { return; }
    try {
      this.capabilities = await gateway.listCapabilities(workspaceRoot);
      this.loadedAt = Date.now();
    } catch {
      // Non-fatal: planner falls back to the built-in heuristic tool list.
    }
  }

  public list(): BackendCapability[] {
    return this.capabilities;
  }

  public buildToolManifestForPrompt(): string {
    if (this.capabilities.length === 0) {
      return "(tool list unavailable — heuristic fallback active)";
    }
    return this.capabilities
      .map((cap) => `- ${cap.name} [${cap.category}]: ${cap.description}`)
      .join("\n");
  }
}
