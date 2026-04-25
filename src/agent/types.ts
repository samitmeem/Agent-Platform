export type AgentPlanSource = "model" | "heuristic";
export type AgentRuntimeMode = "preview" | "action";
export type AgentToolName =
  | "get_project_summary"
  | "find_symbol"
  | "memory_search"
  | "get_dependencies"
  | "get_change_impact"
  | "get_full_context"
  | "discover_project_actions"
  | "run_project_action"
  | "run_impacted_tests"
  | "apply_symbol_change_and_validate";

export interface AgentDirectPlan {
  kind: "direct";
  response: string;
  reasoning: string;
  source: AgentPlanSource;
}

export interface AgentToolPlan {
  kind: "tool";
  toolName: AgentToolName;
  arguments: Record<string, unknown>;
  reasoning: string;
  source: AgentPlanSource;
}

export type AgentPlan = AgentDirectPlan | AgentToolPlan;
