/**
 * FIX-6: Dynamic tool registry.
 *
 * Populated at session start by calling listAllTools() on the ToolProviderRegistry.
 * The planner receives the live list and includes it in the system prompt so the
 * model can choose any available tool.
 *
 * token-savior is no longer the source of truth — any registered ToolProvider
 * contributes its tools to the manifest.
 */

import type { ToolProviderRegistry } from "../tools/providerRegistry";
import type { ToolDefinition } from "../tools/interface";

export type BackendCapability = ToolDefinition;

export class ToolRegistry {
  private capabilities: ToolDefinition[] = [];
  private loadedAt: number | undefined;

  /** Reload if stale (older than 5 minutes) or never loaded. */
  private isStale(): boolean {
    return this.loadedAt === undefined || Date.now() - this.loadedAt > 5 * 60_000;
  }

  public async refresh(providerRegistry: ToolProviderRegistry): Promise<void> {
    if (!this.isStale()) { return; }
    try {
      this.capabilities = await providerRegistry.listAllTools();
      this.loadedAt = Date.now();
    } catch {
      // Non-fatal: planner falls back to the built-in heuristic tool list.
    }
  }

  public list(): ToolDefinition[] {
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
