import type { StoredPreviewRun } from "../state/sessionStore";
import type {
  WorkspaceApprovedWorkflow,
  WorkspacePhaseAssessment,
  WorkspaceProfile,
  WorkspaceProjectMilestone,
  WorkspaceProjectMilestoneSource,
  WorkspaceProjectMode,
  WorkspaceProjectMemory,
  WorkspaceWorkflowOutcome,
} from "../state/workspaceAnalysis";

export interface WorkspaceProjectModeInput {
  profile?: WorkspaceProfile;
  phase?: WorkspacePhaseAssessment;
  projectMemory?: WorkspaceProjectMemory;
  recentRuns?: readonly StoredPreviewRun[];
  previousSnapshot?: WorkspaceProjectMode;
  createdAt?: string;
}

export interface ApprovedWorkflowRecordInput {
  query: string;
  toolSequence: readonly string[];
  summary: string;
  outcome: WorkspaceWorkflowOutcome;
  startedAt: string;
  completedAt?: string;
  activeFilePath?: string;
}

const MAX_PROJECT_MODE_MILESTONES = 6;

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter((value) => value.length > 0))];
}

function compact(text: string, maxLength = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toMilestoneId(source: WorkspaceProjectMilestoneSource, title: string): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${source}:${normalized || "milestone"}`;
}

function createMilestone(
  source: WorkspaceProjectMilestoneSource,
  title: string,
  reason: string,
  createdAt: string,
): WorkspaceProjectMilestone {
  return {
    id: toMilestoneId(source, title),
    title,
    reason,
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

function compareWorkflowTimestamps(left: WorkspaceApprovedWorkflow | undefined, right: WorkspaceApprovedWorkflow | undefined): number {
  const leftTimestamp = left?.completedAt ?? left?.startedAt ?? "";
  const rightTimestamp = right?.completedAt ?? right?.startedAt ?? "";
  if (!leftTimestamp && !rightTimestamp) {
    return 0;
  }
  if (!leftTimestamp) {
    return -1;
  }
  if (!rightTimestamp) {
    return 1;
  }

  return leftTimestamp.localeCompare(rightTimestamp);
}

function pickLatestWorkflow(
  nextWorkflow: WorkspaceApprovedWorkflow | undefined,
  previousWorkflow: WorkspaceApprovedWorkflow | undefined,
): WorkspaceApprovedWorkflow | undefined {
  if (!nextWorkflow) {
    return previousWorkflow;
  }
  if (!previousWorkflow) {
    return nextWorkflow;
  }

  return compareWorkflowTimestamps(nextWorkflow, previousWorkflow) >= 0
    ? nextWorkflow
    : previousWorkflow;
}

function derivePhaseGoal(phase: WorkspacePhaseAssessment | undefined): string | undefined {
  switch (phase?.phase) {
    case "idea-spec":
      return "Turn the current docs into implementation milestones.";
    case "scaffolding":
      return "Finish the source layout and initial validation path.";
    case "implementation":
      return "Keep the next workflow bounded and validate the changed surface.";
    case "testing":
      return "Stay inside the validation loop until failures are resolved.";
    case "hardening":
      return "Review release-sensitive changes before shipping.";
    case "maintenance":
      return "Preserve continuity with small, well-validated changes.";
    default:
      return undefined;
  }
}

function createValidationMilestone(
  profile: WorkspaceProfile | undefined,
  workflow: WorkspaceApprovedWorkflow | undefined,
  createdAt: string,
): WorkspaceProjectMilestone | undefined {
  if (!workflow || workflow.outcome !== "completed") {
    return undefined;
  }

  const changedWorkspace = workflow.toolSequence.some((toolName) => (
    toolName === "apply_symbol_change_and_validate"
    || toolName === "run_project_action"
  ));
  if (!changedWorkspace || workflow.toolSequence.includes("run_impacted_tests")) {
    return undefined;
  }

  const testCommand = profile?.availableTestCommands[0];
  return createMilestone(
    "validation",
    testCommand
      ? `Validate the latest approved workflow with ${testCommand}`
      : "Run impacted tests after the latest approved workflow",
    testCommand
      ? `The latest approved workflow changed workspace state. ${testCommand} is the next safest validation step.`
      : "The latest approved workflow changed workspace state and should be followed by targeted validation.",
    createdAt,
  );
}

function milestoneMatchesText(milestone: WorkspaceProjectMilestone, text: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedTitle = normalizeText(milestone.title);
  if (!normalizedText || !normalizedTitle) {
    return false;
  }

  if (normalizedTitle.length >= 12 && normalizedText.includes(normalizedTitle)) {
    return true;
  }

  const tokens = normalizedTitle.split(" ").filter((token) => token.length > 2);
  if (tokens.length === 0) {
    return false;
  }

  const matchedTokens = tokens.filter((token) => normalizedText.includes(token));
  return matchedTokens.length >= Math.min(2, tokens.length);
}

function runMatchesMilestone(run: StoredPreviewRun, milestone: WorkspaceProjectMilestone): boolean {
  if (run.outcome !== "completed") {
    return false;
  }

  const haystack = [
    run.query,
    run.answer,
    run.activeFilePath,
    run.result.answer,
    extractToolSequence(run).join(" "),
  ].filter(Boolean).join(" ");

  return milestoneMatchesText(milestone, haystack);
}

function workflowMatchesMilestone(workflow: WorkspaceApprovedWorkflow, milestone: WorkspaceProjectMilestone): boolean {
  return milestoneMatchesText(milestone, [workflow.query, workflow.summary, workflow.toolSequence.join(" ")].join(" "));
}

function dedupeMilestones(milestones: readonly WorkspaceProjectMilestone[]): WorkspaceProjectMilestone[] {
  const seen = new Set<string>();
  const deduped: WorkspaceProjectMilestone[] = [];
  for (const milestone of milestones) {
    const key = milestone.title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(milestone);
    if (deduped.length >= MAX_PROJECT_MODE_MILESTONES) {
      break;
    }
  }

  return deduped;
}

export function createApprovedWorkflowRecord(input: ApprovedWorkflowRecordInput): WorkspaceApprovedWorkflow {
  return {
    query: input.query.trim(),
    toolSequence: uniqueStrings(input.toolSequence),
    summary: compact(input.summary, 220),
    outcome: input.outcome,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    activeFilePath: input.activeFilePath,
  };
}

export function createApprovedWorkflowFromRun(run: StoredPreviewRun): WorkspaceApprovedWorkflow | undefined {
  if (run.result.mode !== "action") {
    return undefined;
  }

  return createApprovedWorkflowRecord({
    query: run.query,
    toolSequence: extractToolSequence(run),
    summary: run.answer || run.result.answer,
    outcome: run.outcome ?? "completed",
    startedAt: run.startedAt ?? run.createdAt,
    completedAt: run.createdAt,
    activeFilePath: run.activeFilePath,
  });
}

export function upsertApprovedWorkflow(
  previousSnapshot: WorkspaceProjectMode | undefined,
  workflow: WorkspaceApprovedWorkflow,
  updatedAt = new Date().toISOString(),
): WorkspaceProjectMode {
  return {
    goal: previousSnapshot?.goal,
    milestones: previousSnapshot?.milestones ?? [],
    completedMilestoneIds: previousSnapshot?.completedMilestoneIds ?? [],
    lastApprovedWorkflow: pickLatestWorkflow(workflow, previousSnapshot?.lastApprovedWorkflow),
    updatedAt,
  };
}

export function deriveWorkspaceProjectMode(
  input: WorkspaceProjectModeInput,
): { snapshot: WorkspaceProjectMode; changed: boolean } {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const recentRuns = input.recentRuns ?? [];
  const previousSnapshot = input.previousSnapshot;

  const derivedWorkflow = recentRuns
    .map((run) => createApprovedWorkflowFromRun(run))
    .find((workflow): workflow is WorkspaceApprovedWorkflow => Boolean(workflow));
  const lastApprovedWorkflow = pickLatestWorkflow(derivedWorkflow, previousSnapshot?.lastApprovedWorkflow);

  const goal = input.projectMemory?.currentGoals[0]
    ?? derivePhaseGoal(input.phase)
    ?? input.profile?.likelyActions[0];

  const milestones = dedupeMilestones([
    ...(input.projectMemory?.currentGoals ?? []).slice(0, 3).map((goalText) => createMilestone(
      "goal",
      goalText,
      "Current goal derived from extension-owned project memory.",
      createdAt,
    )),
    ...(input.profile?.likelyActions ?? []).slice(0, 2).map((action) => createMilestone(
      "action",
      action,
      "Concrete action discovered from workspace files and package metadata.",
      createdAt,
    )),
    ...(() => {
      const validationMilestone = createValidationMilestone(input.profile, lastApprovedWorkflow, createdAt);
      return validationMilestone ? [validationMilestone] : [];
    })(),
    ...((!input.projectMemory?.currentGoals.length && input.phase)
      ? [createMilestone(
        "phase",
        derivePhaseGoal(input.phase) ?? `Keep work aligned with the ${input.phase.phase} phase.`,
        "Phase-derived fallback milestone for continuity across sessions.",
        createdAt,
      )]
      : []),
  ]);

  const completedMilestoneIds = uniqueStrings(milestones
    .filter((milestone) => (
      (lastApprovedWorkflow ? workflowMatchesMilestone(lastApprovedWorkflow, milestone) : false)
      || recentRuns.some((run) => runMatchesMilestone(run, milestone))
    ))
    .map((milestone) => milestone.id));

  const nextStateWithoutTimestamp = {
    goal,
    milestones,
    completedMilestoneIds,
    lastApprovedWorkflow,
  };
  const previousStateWithoutTimestamp = previousSnapshot
    ? {
      goal: previousSnapshot.goal,
      milestones: previousSnapshot.milestones,
      completedMilestoneIds: previousSnapshot.completedMilestoneIds,
      lastApprovedWorkflow: previousSnapshot.lastApprovedWorkflow,
    }
    : undefined;
  const changed = JSON.stringify(nextStateWithoutTimestamp) !== JSON.stringify(previousStateWithoutTimestamp);

  return {
    snapshot: {
      ...nextStateWithoutTimestamp,
      updatedAt: changed ? createdAt : previousSnapshot?.updatedAt ?? createdAt,
    },
    changed,
  };
}

export function formatWorkspaceProjectMode(projectMode: WorkspaceProjectMode | undefined): string {
  if (!projectMode) {
    return "No project mode recorded yet.";
  }

  return [
    projectMode.goal ? `Goal: ${projectMode.goal}` : undefined,
    projectMode.milestones.length > 0
      ? [
        "Milestones:",
        ...projectMode.milestones.map((milestone) => `- ${milestone.title} (${milestone.source}) — ${milestone.reason}`),
      ].join("\n")
      : "Milestones: none recorded yet.",
    projectMode.completedMilestoneIds.length > 0
      ? `Completed milestones: ${projectMode.completedMilestoneIds.length}`
      : undefined,
    projectMode.lastApprovedWorkflow
      ? [
        "Last approved workflow:",
        `- Outcome: ${projectMode.lastApprovedWorkflow.outcome}`,
        `- Query: ${projectMode.lastApprovedWorkflow.query}`,
        `- Tool sequence: ${projectMode.lastApprovedWorkflow.toolSequence.join(" -> ") || "none recorded"}`,
        `- Summary: ${projectMode.lastApprovedWorkflow.summary}`,
        `- Started: ${projectMode.lastApprovedWorkflow.startedAt}`,
        projectMode.lastApprovedWorkflow.completedAt ? `- Completed: ${projectMode.lastApprovedWorkflow.completedAt}` : undefined,
        projectMode.lastApprovedWorkflow.activeFilePath ? `- File: ${projectMode.lastApprovedWorkflow.activeFilePath}` : undefined,
      ].filter(Boolean).join("\n")
      : undefined,
    `Updated: ${projectMode.updatedAt}`,
  ].filter(Boolean).join("\n\n");
}