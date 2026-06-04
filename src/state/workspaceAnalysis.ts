export type WorkspaceRepoType =
  | "docs-only"
  | "node-typescript"
  | "node-javascript"
  | "python"
  | "dart-flutter"
  | "mixed"
  | "unknown";

export interface WorkspaceProfile {
  workspaceRoot: string;
  repoType: WorkspaceRepoType;
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  testFrameworks: string[];
  availableTestCommands: string[];
  hasDocker: boolean;
  hasCi: boolean;
  hasEnvFiles: boolean;
  hasInstructionDocs: boolean;
  hasChangelog: boolean;
  sourceDirectories: string[];
  testDirectories: string[];
  riskAreas: string[];
  likelyActions: string[];
  generatedAt: string;
}

export type WorkspacePhase =
  | "idea-spec"
  | "scaffolding"
  | "implementation"
  | "testing"
  | "hardening"
  | "maintenance";

export interface WorkspacePhaseAssessment {
  phase: WorkspacePhase;
  confidence: number;
  reasons: string[];
  updatedAt: string;
}

export type WorkspaceSuggestionPriority = "high" | "medium" | "low";

export type WorkspaceSuggestionSource =
  | "refresh"
  | "phase"
  | "validation"
  | "tests"
  | "config"
  | "risk"
  | "actions"
  | "continuity";

export interface WorkspaceSuggestion {
  id: string;
  title: string;
  reason: string;
  priority: WorkspaceSuggestionPriority;
  source: WorkspaceSuggestionSource;
  createdAt: string;
}

export type WorkspaceWorkflowOutcome = "completed" | "failed" | "cancelled";

export type WorkspaceProjectMilestoneSource = "goal" | "action" | "validation" | "phase";

export interface WorkspaceProjectMilestone {
  id: string;
  title: string;
  reason: string;
  source: WorkspaceProjectMilestoneSource;
  createdAt: string;
}

export interface WorkspaceApprovedWorkflow {
  query: string;
  toolSequence: string[];
  summary: string;
  outcome: WorkspaceWorkflowOutcome;
  startedAt: string;
  completedAt?: string;
  activeFilePath?: string;
}

export interface WorkspaceProjectMode {
  goal?: string;
  milestones: WorkspaceProjectMilestone[];
  completedMilestoneIds: string[];
  lastApprovedWorkflow?: WorkspaceApprovedWorkflow;
  updatedAt: string;
}

export type WorkspaceProjectMemorySectionKey =
  | "purpose"
  | "stackSummary"
  | "conventions"
  | "availableTestCommands"
  | "dangerousAreas"
  | "currentGoals";

export interface WorkspaceProjectMemory {
  purpose?: string;
  stackSummary: string;
  conventions: string[];
  availableTestCommands: string[];
  dangerousAreas: string[];
  currentGoals: string[];
  canonicalSources: string[];
  summary: string;
  summaryFingerprint: string;
  sectionFingerprints: Partial<Record<WorkspaceProjectMemorySectionKey, string>>;
  updatedAt: string;
}

export type WorkspaceRefreshStatus = "idle" | "running" | "ready" | "error";

export interface WorkspaceRefreshState {
  status: WorkspaceRefreshStatus;
  stale: boolean;
  warnings: string[];
  lastRefreshAt?: string;
  lastSuccessfulRefreshAt?: string;
  lastError?: string;
}

export const DEFAULT_WORKSPACE_REFRESH_STATE: WorkspaceRefreshState = {
  status: "idle",
  stale: false,
  warnings: [],
};
