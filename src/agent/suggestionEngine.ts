import type { StoredPreviewRun } from "../state/sessionStore";
import type {
  WorkspaceApprovedWorkflow,
  WorkspacePhaseAssessment,
  WorkspaceProfile,
  WorkspaceProjectMemory,
  WorkspaceRefreshState,
  WorkspaceSuggestion,
  WorkspaceSuggestionPriority,
  WorkspaceSuggestionSource,
} from "../state/workspaceAnalysis";

export interface DiscoveredWorkspaceAction {
  label: string;
  description?: string;
  kind?: string;
  source?: string;
  runnable?: boolean;
}

export interface WorkspaceSuggestionEngineInput {
  profile?: WorkspaceProfile;
  phase?: WorkspacePhaseAssessment;
  projectMemory?: WorkspaceProjectMemory;
  refresh?: WorkspaceRefreshState;
  lastApprovedWorkflow?: WorkspaceApprovedWorkflow;
  recentRuns?: readonly StoredPreviewRun[];
  discoveredActions?: readonly DiscoveredWorkspaceAction[];
  maxSuggestions?: number;
  createdAt?: string;
}

const DEFAULT_MAX_SUGGESTIONS = 6;

const PRIORITY_RANK: Record<WorkspaceSuggestionPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function summarizeText(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function toSuggestionId(source: WorkspaceSuggestionSource, title: string): string {
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${source}:${normalizedTitle || "suggestion"}`;
}

function createSuggestion(
  source: WorkspaceSuggestionSource,
  priority: WorkspaceSuggestionPriority,
  title: string,
  reason: string,
  createdAt: string,
): WorkspaceSuggestion {
  return {
    id: toSuggestionId(source, title),
    title,
    reason,
    priority,
    source,
    createdAt,
  };
}

function extractToolSequence(run: StoredPreviewRun): string[] {
  const plans = run.result.plans ?? [run.result.plan];
  return plans.flatMap((plan) => (
    plan.kind === "tool" && typeof plan.toolName === "string"
      ? [plan.toolName]
      : []
  ));
}

function isFailedValidationRun(run: StoredPreviewRun): boolean {
  const sequence = extractToolSequence(run).join(" ");
  return run.outcome === "failed"
    && (/test|validate|impact/i.test(run.query) || /run_impacted_tests|apply_symbol_change_and_validate/i.test(sequence));
}

function getMostRecentCompletedRun(runs: readonly StoredPreviewRun[]): StoredPreviewRun | undefined {
  return runs.find((run) => run.outcome === "completed");
}

function shouldSuggestValidationFollowUp(workflow: WorkspaceApprovedWorkflow | undefined): boolean {
  if (!workflow || workflow.outcome !== "completed") {
    return false;
  }

  return workflow.toolSequence.some((toolName) => (
    toolName === "apply_symbol_change_and_validate"
    || toolName === "run_project_action"
  )) && !workflow.toolSequence.includes("run_impacted_tests");
}

function getPhaseSuggestion(
  phase: WorkspacePhaseAssessment | undefined,
  profile: WorkspaceProfile | undefined,
  createdAt: string,
): WorkspaceSuggestion | undefined {
  if (!phase) {
    return undefined;
  }

  switch (phase.phase) {
    case "idea-spec":
      return createSuggestion(
        "phase",
        "high",
        "Turn the current docs into implementation milestones",
        "The workspace still looks specification-heavy, so converting docs into concrete milestones is the safest next step.",
        createdAt,
      );
    case "scaffolding":
      return createSuggestion(
        "phase",
        "high",
        "Finish the source layout before broader changes",
        "The project is still in scaffolding mode, so stabilizing structure first reduces downstream churn.",
        createdAt,
      );
    case "implementation":
      return createSuggestion(
        "phase",
        profile && profile.availableTestCommands.length === 0 ? "high" : "medium",
        "Add focused validation around the next changed module",
        "The workspace is in implementation mode, so pairing the next change with focused validation keeps momentum without losing safety.",
        createdAt,
      );
    case "testing":
      return createSuggestion(
        "phase",
        "high",
        "Stay in the validation loop until failures are resolved",
        "The workspace is already in testing mode, so new feature work should wait until current checks are stable.",
        createdAt,
      );
    case "hardening":
      return createSuggestion(
        "phase",
        "medium",
        "Review release-sensitive files before shipping",
        "Hardening mode usually means packaging, CI, and deployment paths deserve an extra pass.",
        createdAt,
      );
    case "maintenance":
      return createSuggestion(
        "phase",
        "low",
        "Keep the next change incremental and well-validated",
        "Maintenance mode favors small, reversible changes that keep the repo stable across sessions.",
        createdAt,
      );
    default:
      return undefined;
  }
}

export function deriveWorkspaceSuggestions(input: WorkspaceSuggestionEngineInput): WorkspaceSuggestion[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const recentRuns = input.recentRuns ?? [];
  const suggestions: WorkspaceSuggestion[] = [];

  if (input.refresh?.lastError) {
    suggestions.push(createSuggestion(
      "refresh",
      "high",
      "Resolve the latest workspace refresh failure",
      `The background refresh coordinator reported: ${summarizeText(input.refresh.lastError)}`,
      createdAt,
    ));
  } else if (input.refresh?.stale) {
    suggestions.push(createSuggestion(
      "refresh",
      "medium",
      "Refresh workspace context before relying on stale state",
      "The last successful refresh is stale, so workspace guidance may be outdated until the next successful refresh completes.",
      createdAt,
    ));
  }

  const failedValidationRun = recentRuns.find(isFailedValidationRun);
  if (failedValidationRun) {
    suggestions.push(createSuggestion(
      "validation",
      "high",
      "Fix recent validation failures before new feature work",
      `A recent run failed while validating work: ${summarizeText(failedValidationRun.query)}`,
      createdAt,
    ));
  }

  if (input.lastApprovedWorkflow?.outcome === "failed") {
    suggestions.push(createSuggestion(
      "validation",
      "high",
      "Resolve failures from the latest approved workflow",
      `The latest approved workflow ended in failure: ${summarizeText(input.lastApprovedWorkflow.summary)}`,
      createdAt,
    ));
  } else if (shouldSuggestValidationFollowUp(input.lastApprovedWorkflow)) {
    suggestions.push(createSuggestion(
      "validation",
      "high",
      "Run impacted tests after the latest approved workflow",
      `The latest approved workflow changed workspace state via ${input.lastApprovedWorkflow?.toolSequence.join(" -> ")} and should be followed by targeted validation.`,
      createdAt,
    ));
  }

  const currentGoals = input.projectMemory?.currentGoals ?? [];
  for (const goal of currentGoals.slice(0, 2)) {
    suggestions.push(createSuggestion(
      "continuity",
      /test|validate|fix|review/i.test(goal) ? "high" : "medium",
      goal,
      "The extension-owned project memory marked this as a current goal for the workspace.",
      createdAt,
    ));
  }

  const missingTests = input.profile
    && input.profile.repoType !== "docs-only"
    && input.profile.repoType !== "unknown"
    && input.profile.availableTestCommands.length === 0
    && input.profile.testDirectories.length === 0
    && input.profile.testFrameworks.length === 0;
  if (missingTests) {
    suggestions.push(createSuggestion(
      "tests",
      "high",
      "Add or document a test harness before broader implementation",
      "The workspace has source code but no detected test framework, test directories, or test commands yet.",
      createdAt,
    ));
  }

  if (input.profile?.sourceDirectories.length && !input.profile.hasEnvFiles) {
    suggestions.push(createSuggestion(
      "config",
      "medium",
      "Document required runtime configuration or env variables",
      "The workspace has source directories but no `.env*` files were detected, so documenting required config can prevent setup drift.",
      createdAt,
    ));
  }

  const phaseSuggestion = getPhaseSuggestion(input.phase, input.profile, createdAt);
  if (phaseSuggestion && currentGoals.length === 0) {
    suggestions.push(phaseSuggestion);
  }

  const validationAction = input.discoveredActions?.find((action) => /test|validate/i.test(`${action.kind ?? ""} ${action.label}`));
  if (validationAction) {
    suggestions.push(createSuggestion(
      "actions",
      "medium",
      `Run available validation step: ${validationAction.label}`,
      validationAction.description
        ? summarizeText(validationAction.description)
        : "A validation-oriented action was discovered from current workspace state.",
      createdAt,
    ));
  } else if (input.discoveredActions?.[0]) {
    suggestions.push(createSuggestion(
      "actions",
      "low",
      `Review available project action: ${input.discoveredActions[0].label}`,
      input.discoveredActions[0].description
        ? summarizeText(input.discoveredActions[0].description)
        : "A project action was discovered from current workspace state.",
      createdAt,
    ));
  }

  if (input.profile?.riskAreas.some((area) => /package\.json|workflow|docker|extension\.ts/i.test(area))) {
    suggestions.push(createSuggestion(
      "risk",
      "medium",
      "Review release-sensitive or shared infrastructure paths carefully",
      `The workspace flagged risky areas such as ${input.profile.riskAreas.slice(0, 3).join(", ")}.`,
      createdAt,
    ));
  }

  const recentCompletedRun = getMostRecentCompletedRun(recentRuns);
  if (recentCompletedRun) {
    suggestions.push(createSuggestion(
      "continuity",
      "low",
      "Continue from the most recent completed work",
      `Latest successful run: ${summarizeText(recentCompletedRun.query)}`,
      createdAt,
    ));
  }

  const deduped = new Map<string, WorkspaceSuggestion>();
  for (const suggestion of suggestions) {
    const key = suggestion.title.toLowerCase();
    const existing = deduped.get(key);
    if (!existing || PRIORITY_RANK[suggestion.priority] > PRIORITY_RANK[existing.priority]) {
      deduped.set(key, suggestion);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      return PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority];
    })
    .slice(0, Math.max(1, input.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS));
}