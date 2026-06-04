import type { ToolDefinition, ToolProvider, ToolResult, MemoryCapability } from "./interface";

/** How long (ms) a cached listTools() result is considered fresh. */
const TOOL_CACHE_TTL_MS = 30_000;

interface ToolCacheEntry {
  tools: ToolDefinition[];
  fetchedAt: number;
}

export class ToolProviderRegistry {
  private readonly providers: ToolProvider[] = [];
  /** CRITICAL-4: per-provider tool list cache to avoid repeated JSON-RPC round-trips. */
  private readonly toolCache = new Map<string, ToolCacheEntry>();

  private invalidateCache(id: string): void {
    this.toolCache.delete(id);
  }

  private async getCachedTools(provider: ToolProvider): Promise<ToolDefinition[]> {
    const cached = this.toolCache.get(provider.id);
    if (cached && Date.now() - cached.fetchedAt < TOOL_CACHE_TTL_MS) {
      return cached.tools;
    }
    const tools = await provider.listTools();
    this.toolCache.set(provider.id, { tools, fetchedAt: Date.now() });
    return tools;
  }

  public registerProvider(provider: ToolProvider): void {
    const existing = this.providers.findIndex((p) => p.id === provider.id);
    if (existing >= 0) {
      this.providers[existing] = provider;
    } else {
      this.providers.push(provider);
    }
    // Invalidate stale cache for this provider id on (re-)registration.
    this.invalidateCache(provider.id);
  }

  public unregisterProvider(id: string): void {
    const index = this.providers.findIndex((p) => p.id === id);
    if (index >= 0) {
      this.providers.splice(index, 1);
    }
    this.invalidateCache(id);
  }

  public getProviders(): ToolProvider[] {
    return [...this.providers];
  }

  public async listAllTools(): Promise<ToolDefinition[]> {
    const results = await Promise.all(this.providers.map((p) => this.getCachedTools(p)));
    return results.flat();
  }

  public async routeTool(
    name: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<ToolResult> {
    for (const provider of this.providers) {
      const tools = await this.getCachedTools(provider);
      if (tools.some((t) => t.name === name)) {
        return provider.invokeTool(name, args, workspaceRoot);
      }
    }

    // No provider can handle the tool — return graceful no-op
    return {
      name,
      ok: false,
      content: [],
      error: `No tool provider registered for tool: ${name}`,
    };
  }

  public async disposeAll(): Promise<void> {
    await Promise.all(this.providers.map((p) => p.dispose()));
    this.providers.length = 0;
    this.toolCache.clear();
  }

  /**
   * Returns the first registered provider that declares a memory capability.
   * Core agent code uses this to resolve tool names without hardcoding them.
   */
  public resolveMemoryCapability(): MemoryCapability | undefined {
    for (const provider of this.providers) {
      if (provider.memoryCapability) { return provider.memoryCapability; }
    }
    return undefined;
  }
}
