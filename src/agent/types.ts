export type AgentPlanSource = "model" | "heuristic";
export type AgentRuntimeMode = "preview" | "action";
/** Tool names are discovered dynamically from registered ToolProviders at runtime. */
export type AgentToolName = string;

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
