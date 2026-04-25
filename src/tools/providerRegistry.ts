import type { ToolDefinition, ToolProvider, ToolResult, MemoryCapability } from "./interface";

export class ToolProviderRegistry {
  private readonly providers: ToolProvider[] = [];

  public registerProvider(provider: ToolProvider): void {
    const existing = this.providers.findIndex((p) => p.id === provider.id);
    if (existing >= 0) {
      this.providers[existing] = provider;
    } else {
      this.providers.push(provider);
    }
  }

  public unregisterProvider(id: string): void {
    const index = this.providers.findIndex((p) => p.id === id);
    if (index >= 0) {
      this.providers.splice(index, 1);
    }
  }

  public getProviders(): ToolProvider[] {
    return [...this.providers];
  }

  public async listAllTools(): Promise<ToolDefinition[]> {
    const results = await Promise.all(this.providers.map((p) => p.listTools()));
    return results.flat();
  }

  public async routeTool(
    name: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<ToolResult> {
    for (const provider of this.providers) {
      const tools = await provider.listTools();
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
