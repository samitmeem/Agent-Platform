import type { ToolSafetyClass } from "../tools/interface";

export type { ToolSafetyClass };

export interface ToolPolicy {
  toolName: string;
  title: string;
  safetyClass: ToolSafetyClass;
  mutatesWorkspace: boolean;
  requiresApprovalByDefault: boolean;
}

const DEFAULT_POLICY: Omit<ToolPolicy, "toolName"> = {
  title:                     "Unknown Tool",
  safetyClass:               "command",
  mutatesWorkspace:          true,
  requiresApprovalByDefault: true,
};

export class ToolPolicyRegistry {
  private readonly policies = new Map<string, ToolPolicy>();

  public register(newPolicies: ToolPolicy[]): void {
    for (const policy of newPolicies) {
      this.policies.set(policy.toolName, policy);
    }
  }

  public resolve(toolName: string): ToolPolicy {
    return this.policies.get(toolName) ?? { toolName, ...DEFAULT_POLICY };
  }
}

/** Module-level singleton — used by consumers that have not been migrated to DI yet. */
export const globalToolPolicyRegistry = new ToolPolicyRegistry();
