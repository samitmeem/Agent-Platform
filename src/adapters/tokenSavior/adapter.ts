import type { ToolDefinition, ToolProvider, ToolResult, MemoryCapability } from "../../tools/interface";
import type { ToolPolicyRegistry } from "../../policies/toolPolicy";
import type { BackendLaunchConfig } from "./processManager";
import { BackendGateway } from "./gateway";
import type { ServiceToolResult } from "./protocol";

/** Token-savior tool policies — registered at activation time, not hardcoded in core. */
const TOKEN_SAVIOR_TOOL_DEFINITIONS: ToolDefinition[] = [
  { name: "get_project_summary",           category: "read",        description: "Get a high-level summary of the project.",                          safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "find_symbol",                   category: "read",        description: "Locate a symbol (function, class, variable) in the project.",       safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "memory_search",                 category: "memory",      description: "Search the project memory store.",                                  safetyClass: "memory",      mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "memory_session_history",        category: "memory",      description: "Retrieve recent session history.",                                  safetyClass: "memory",      mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "memory_save",                   category: "memory",      description: "Save a note to project memory.",                                    safetyClass: "memory",      mutatesWorkspace: true,  requiresApprovalByDefault: false },
  { name: "memory_maintain",               category: "memory",      description: "Compact and maintain the project memory store.",                    safetyClass: "memory",      mutatesWorkspace: true,  requiresApprovalByDefault: true  },
  { name: "get_dependencies",              category: "read",        description: "Show dependencies for a symbol or module.",                         safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "get_change_impact",             category: "read",        description: "Show the impact of changing a symbol.",                             safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "get_full_context",              category: "read",        description: "Retrieve full context for the active symbol.",                      safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "reindex",                       category: "read",        description: "Reindex the workspace.",                                            safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "list_checkpoints",              category: "read",        description: "List available checkpoints.",                                       safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "create_checkpoint",             category: "edit",        description: "Create a new checkpoint.",                                          safetyClass: "edit",        mutatesWorkspace: true,  requiresApprovalByDefault: true  },
  { name: "restore_checkpoint",            category: "destructive", description: "Restore a checkpoint.",                                             safetyClass: "destructive", mutatesWorkspace: true,  requiresApprovalByDefault: true  },
  { name: "apply_symbol_change_and_validate", category: "edit",    description: "Apply a symbol change and run validation.",                         safetyClass: "edit",        mutatesWorkspace: true,  requiresApprovalByDefault: true  },
  { name: "replace_symbol_source",         category: "edit",        description: "Replace the source of a symbol.",                                   safetyClass: "edit",        mutatesWorkspace: true,  requiresApprovalByDefault: true  },
  { name: "discover_project_actions",      category: "read",        description: "Discover available project actions.",                               safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "run_project_action",            category: "command",     description: "Run a project action.",                                             safetyClass: "command",     mutatesWorkspace: true,  requiresApprovalByDefault: true  },
  { name: "find_impacted_test_files",      category: "read",        description: "Find test files impacted by a change.",                             safetyClass: "read",        mutatesWorkspace: false, requiresApprovalByDefault: false },
  { name: "run_impacted_tests",            category: "test",        description: "Run impacted tests.",                                               safetyClass: "test",        mutatesWorkspace: true,  requiresApprovalByDefault: true  },
];

function toToolResult(result: ServiceToolResult): ToolResult {
  return {
    name:    result.name,
    ok:      result.ok,
    content: result.content,
    error:   result.error,
  };
}

export class TokenSaviorToolProvider implements ToolProvider {
  public readonly id = "token-savior";
  public readonly displayName = "Token Savior";

  /** Declares the tool names used for memory operations so core code never hardcodes them. */
  public readonly memoryCapability: MemoryCapability = {
    searchToolName: "memory_search",
    sessionHistoryToolName: "memory_session_history",
    saveToolName: "memory_save",
  };

  private readonly gateway: BackendGateway;
  /** Live tool list fetched from the backend — falls back to static definitions. */
  private liveTools: ToolDefinition[] | undefined;

  public constructor(
    resolveLaunchConfig: (workspaceRoot: string) => BackendLaunchConfig,
    private readonly policyRegistry: ToolPolicyRegistry,
  ) {
    this.gateway = new BackendGateway(resolveLaunchConfig);
    // Register token-savior policies at construction time
    policyRegistry.register(
      TOKEN_SAVIOR_TOOL_DEFINITIONS.map((d) => ({
        toolName:                   d.name,
        title:                      d.description,
        safetyClass:                d.safetyClass,
        mutatesWorkspace:           d.mutatesWorkspace,
        requiresApprovalByDefault:  d.requiresApprovalByDefault,
      })),
    );
  }

  public async isAvailable(): Promise<boolean> {
    try {
      // Use an empty string as a probe — the gateway resolves the actual workspace root
      // from the launch config, so passing an empty string is only valid when the
      // gateway was already connected. Callers should pass the real workspaceRoot
      // when possible. This is intentionally best-effort.
      const health = await this.gateway.getLastHealth();
      return health !== undefined;
    } catch {
      return false;
    }
  }

  public async listTools(): Promise<ToolDefinition[]> {
    return this.liveTools ?? TOKEN_SAVIOR_TOOL_DEFINITIONS;
  }

  public async refreshToolList(workspaceRoot: string): Promise<void> {
    try {
      const caps = await this.gateway.listCapabilities(workspaceRoot);
      this.liveTools = caps.map((cap) => {
        const staticDef = TOKEN_SAVIOR_TOOL_DEFINITIONS.find((d) => d.name === cap.name);
        return {
          name:                       cap.name,
          category:                   cap.category,
          description:                cap.description,
          safetyClass:                staticDef?.safetyClass ?? "command",
          mutatesWorkspace:           staticDef?.mutatesWorkspace ?? true,
          requiresApprovalByDefault:  staticDef?.requiresApprovalByDefault ?? true,
        };
      });
    } catch {
      // Non-fatal: keep using static definitions
    }
  }

  public async invokeTool(
    name: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<ToolResult> {
    const result = await this.gateway.invokeTool(workspaceRoot, name, args);
    return toToolResult(result);
  }

  /** Expose the underlying gateway for status bar / health check consumers. */
  public getGateway(): BackendGateway {
    return this.gateway;
  }

  public async dispose(): Promise<void> {
    await this.gateway.stop();
  }
}
