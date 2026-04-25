export type ToolSafetyClass = "read" | "memory" | "edit" | "test" | "command" | "destructive";

export interface ToolPolicy {
  toolName: string;
  title: string;
  safetyClass: ToolSafetyClass;
  mutatesWorkspace: boolean;
  requiresApprovalByDefault: boolean;
}

const TOOL_POLICIES = new Map<string, ToolPolicy>([
  ["get_project_summary", { toolName: "get_project_summary", title: "Project Summary", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["find_symbol", { toolName: "find_symbol", title: "Find Symbol", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["memory_search", { toolName: "memory_search", title: "Search Project Memory", safetyClass: "memory", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["memory_session_history", { toolName: "memory_session_history", title: "Session History", safetyClass: "memory", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["memory_save", { toolName: "memory_save", title: "Save Project Memory", safetyClass: "memory", mutatesWorkspace: true, requiresApprovalByDefault: false }],
  ["memory_maintain", { toolName: "memory_maintain", title: "Maintain Project Memory", safetyClass: "memory", mutatesWorkspace: true, requiresApprovalByDefault: true }],
  ["get_dependencies", { toolName: "get_dependencies", title: "Show Dependencies", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["get_change_impact", { toolName: "get_change_impact", title: "Show Change Impact", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["get_full_context", { toolName: "get_full_context", title: "Analyze Current Symbol", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["reindex", { toolName: "reindex", title: "Reindex Workspace", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["list_checkpoints", { toolName: "list_checkpoints", title: "List Checkpoints", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["create_checkpoint", { toolName: "create_checkpoint", title: "Create Checkpoint", safetyClass: "edit", mutatesWorkspace: true, requiresApprovalByDefault: true }],
  ["restore_checkpoint", { toolName: "restore_checkpoint", title: "Restore Checkpoint", safetyClass: "destructive", mutatesWorkspace: true, requiresApprovalByDefault: true }],
  ["apply_symbol_change_and_validate", { toolName: "apply_symbol_change_and_validate", title: "Apply Symbol Change", safetyClass: "edit", mutatesWorkspace: true, requiresApprovalByDefault: true }],
  ["replace_symbol_source", { toolName: "replace_symbol_source", title: "Replace Symbol Source", safetyClass: "edit", mutatesWorkspace: true, requiresApprovalByDefault: true }],
  ["discover_project_actions", { toolName: "discover_project_actions", title: "Discover Project Actions", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["run_project_action", { toolName: "run_project_action", title: "Run Project Action", safetyClass: "command", mutatesWorkspace: true, requiresApprovalByDefault: true }],
  ["find_impacted_test_files", { toolName: "find_impacted_test_files", title: "Find Impacted Tests", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false }],
  ["run_impacted_tests", { toolName: "run_impacted_tests", title: "Run Impacted Tests", safetyClass: "test", mutatesWorkspace: true, requiresApprovalByDefault: true }],
]);

export function resolveToolPolicy(toolName: string): ToolPolicy {
  return TOOL_POLICIES.get(toolName) ?? {
    toolName,
    title: toolName,
    safetyClass: "command",
    mutatesWorkspace: true,
    requiresApprovalByDefault: true,
  };
}
