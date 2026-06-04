import type {
  WorkspacePhaseAssessment,
  WorkspaceProfile,
  WorkspaceProjectMode,
  WorkspaceProjectMemory,
  WorkspaceRefreshState,
  WorkspaceSuggestion,
} from "../state/workspaceAnalysis";
import type { SessionStore, StoredPreviewRun } from "../state/sessionStore";
import type { WorkspaceStore } from "../state/workspaceStore";
import { tryParseJsonContent, type ToolResult } from "../tools/interface";
import { formatWorkspaceProjectMode } from "./projectMode";

export interface CopilotWorkspaceStateSnapshot {
  workspaceRoot: string;
  profile?: WorkspaceProfile;
  phase?: WorkspacePhaseAssessment;
  refresh: WorkspaceRefreshState;
  projectMode?: WorkspaceProjectMode;
  projectMemory?: WorkspaceProjectMemory;
  suggestions: WorkspaceSuggestion[];
  recentRuns: StoredPreviewRun[];
}

export interface BackendDiscoveredProjectAction {
  id: string;
  description?: string;
  kind?: string;
}

export interface CopilotProjectActionSuggestion {
  label: string;
  description?: string;
  kind?: string;
  source: "workspace-state" | "backend";
  runnable: boolean;
}

export const DEFAULT_MAX_NEXT_ACTIONS = 5;
export const DEFAULT_MAX_RECENT_RUNS = 3;
export const DEFAULT_MAX_PROJECT_ACTIONS = 8;

const PHASE_ACTION_HINTS: Record<NonNullable<WorkspacePhaseAssessment["phase"]>, string[]> = {
  "idea-spec": [
    "Turn the current docs into an implementation milestone list.",
    "Stabilize the initial scaffold before broader changes.",
  ],
  scaffolding: [
    "Finish the source layout and initial validation path.",
    "Add a focused test harness before larger implementation changes.",
  ],
  implementation: [
    "Continue implementation in the current architecture lane.",
    "Add focused tests around the next changed module.",
  ],
  testing: [
    "Run impacted validation before widening the change set.",
    "Use recent failures to guide the next safe iteration.",
  ],
  hardening: [
    "Review packaging, CI, and release-sensitive paths carefully.",
    "Tighten validation around risky files before shipping.",
  ],
  maintenance: [
    "Prefer incremental changes with validation after each impactful edit.",
    "Keep project context and release-sensitive paths aligned.",
  ],
};

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter((value) => value.length > 0))];
}

function summarizeText(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function clampPositiveInteger(value: number | undefined, fallback: number, maxValue: number): number {
  if (!Number.isInteger(value) || !value || value < 1) {
    return fallback;
  }

  return Math.min(value, maxValue);
}

function extractToolSequence(run: StoredPreviewRun): string[] {
  const plans = run.result.plans ?? [run.result.plan];
  return plans.flatMap((plan) => (
    plan.kind === "tool" && typeof plan.toolName === "string"
      ? [plan.toolName]
      : []
  ));
}

function isBackendDiscoveredProjectAction(value: unknown): value is BackendDiscoveredProjectAction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate["id"] === "string";
}

export function joinSections(sections: Array<string | undefined>): string {
  return sections.filter((section): section is string => Boolean(section && section.trim().length > 0)).join("\n\n");
}

export function renderBulletList(items: readonly string[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function createWorkspaceSnapshot(
  workspaceRoot: string,
  workspaceStore: WorkspaceStore,
  sessionStore: SessionStore,
): CopilotWorkspaceStateSnapshot {
  return {
    workspaceRoot,
    profile: workspaceStore.getWorkspaceProfile(),
    phase: workspaceStore.getWorkspacePhase(),
    refresh: workspaceStore.getWorkspaceRefreshState(),
    projectMode: workspaceStore.getWorkspaceProjectMode(),
    projectMemory: workspaceStore.getWorkspaceProjectMemory(),
    suggestions: workspaceStore.getWorkspaceSuggestions(),
    recentRuns: sessionStore.listPreviewRuns(DEFAULT_MAX_PROJECT_ACTIONS),
  };
}

export function formatWorkspaceSuggestions(
  suggestions: readonly WorkspaceSuggestion[],
  maxSuggestions = DEFAULT_MAX_NEXT_ACTIONS,
  includeReasons = true,
): string {
  const selected = suggestions.slice(0, Math.max(1, maxSuggestions));
  if (selected.length === 0) {
    return "No workspace suggestions are stored yet.";
  }

  return selected.map((suggestion) => (
    includeReasons
      ? `- [${suggestion.priority}] ${suggestion.title} — ${suggestion.reason}`
      : `- ${suggestion.title}`
  )).join("\n");
}

export function formatWorkspaceProfileSummary(
  profile: WorkspaceProfile | undefined,
  refresh?: WorkspaceRefreshState,
): string {
  if (!profile) {
    return joinSections([
      "No workspace profile is stored yet.",
      refresh ? `Refresh status: ${refresh.status}${refresh.stale ? " (stale)" : ""}` : undefined,
      refresh?.lastError ? `Last refresh error: ${refresh.lastError}` : undefined,
    ]);
  }

  return joinSections([
    `Workspace root: ${profile.workspaceRoot}`,
    [
      `Repo type: ${profile.repoType}`,
      `Languages: ${profile.languages.join(", ") || "unknown"}`,
      `Frameworks: ${profile.frameworks.join(", ") || "none detected"}`,
      `Package managers: ${profile.packageManagers.join(", ") || "none detected"}`,
      `Test frameworks: ${profile.testFrameworks.join(", ") || "none detected"}`,
      `Test commands: ${profile.availableTestCommands.join(", ") || "none detected"}`,
      `Source directories: ${profile.sourceDirectories.join(", ") || "none detected"}`,
      `Test directories: ${profile.testDirectories.join(", ") || "none detected"}`,
      `Risk areas: ${profile.riskAreas.join(", ") || "none detected"}`,
      `Likely actions: ${profile.likelyActions.join(", ") || "none detected"}`,
      `Generated: ${profile.generatedAt}`,
      `Refresh status: ${refresh?.status ?? "idle"}${refresh?.stale ? " (stale)" : ""}`,
      refresh?.lastSuccessfulRefreshAt ? `Last successful refresh: ${refresh.lastSuccessfulRefreshAt}` : undefined,
      refresh?.lastError ? `Last refresh error: ${refresh.lastError}` : undefined,
    ].filter(Boolean).join("\n"),
    refresh?.warnings.length
      ? `Warnings:\n${renderBulletList(refresh.warnings)}`
      : undefined,
  ]);
}

export function formatPhaseAssessmentSummary(phase: WorkspacePhaseAssessment | undefined): string {
  if (!phase) {
    return "No lifecycle phase assessment is stored yet.";
  }

  return joinSections([
    `Current lifecycle phase: ${phase.phase}`,
    [
      `Confidence: ${Math.round(phase.confidence * 100)}%`,
      `Updated: ${phase.updatedAt}`,
    ].join("\n"),
    phase.reasons.length > 0
      ? `Reasons:\n${renderBulletList(phase.reasons)}`
      : undefined,
  ]);
}

export function listCopilotTestCommands(snapshot: CopilotWorkspaceStateSnapshot): string[] {
  return uniqueStrings([
    ...(snapshot.profile?.availableTestCommands ?? []),
    ...(snapshot.projectMemory?.availableTestCommands ?? []),
  ]).slice(0, DEFAULT_MAX_PROJECT_ACTIONS);
}

export function deriveCopilotNextActions(
  snapshot: CopilotWorkspaceStateSnapshot,
  maxActions = DEFAULT_MAX_NEXT_ACTIONS,
): string[] {
  if (snapshot.suggestions.length > 0) {
    return snapshot.suggestions.slice(0, Math.max(1, maxActions)).map((suggestion) => suggestion.title);
  }

  const actions: string[] = [];

  if (snapshot.refresh.lastError) {
    actions.push(`Review the latest workspace refresh issue: ${summarizeText(snapshot.refresh.lastError, 120)}`);
  }
  if (snapshot.refresh.stale) {
    actions.push("Refresh workspace context before relying on stale background state.");
  }

  actions.push(...(snapshot.projectMemory?.currentGoals ?? []));
  if (snapshot.projectMode?.goal) {
    actions.push(snapshot.projectMode.goal);
  }
  actions.push(...(snapshot.projectMode?.milestones.map((milestone) => milestone.title) ?? []));
  if (snapshot.phase) {
    actions.push(...PHASE_ACTION_HINTS[snapshot.phase.phase]);
  }
  actions.push(...(snapshot.profile?.likelyActions ?? []));

  const testCommands = listCopilotTestCommands(snapshot);
  if (testCommands.length > 0) {
    actions.push(`Validate impactful changes with ${testCommands[0]}.`);
  }

  const deduped = uniqueStrings(actions).slice(0, Math.max(1, maxActions));
  if (deduped.length > 0) {
    return deduped;
  }

  return ["Wait for workspace profiling to finish, then inspect the observability dashboard for the next safe step."];
}

export function formatCopilotRecentRunSummary(
  runs: readonly StoredPreviewRun[],
  maxRuns = DEFAULT_MAX_RECENT_RUNS,
): string {
  const selected = runs.slice(0, Math.max(1, maxRuns));
  if (selected.length === 0) {
    return "No preview or action runs have been recorded in this session yet.";
  }

  return selected.map((run) => {
    const toolSequence = extractToolSequence(run);
    const primaryPlan = run.result.plan.kind === "tool"
      ? `tool=${run.result.plan.toolName}`
      : "direct response";
    const sequenceSummary = toolSequence.length > 1
      ? ` · sequence=${toolSequence.join(" -> ")}`
      : "";

    return [
      `- ${run.createdAt} [${run.result.mode ?? "preview"}/${run.outcome ?? "completed"}] ${summarizeText(run.query, 110)}`,
      `  Provider: ${run.result.providerKind ?? "none"} · Plan: ${primaryPlan}${sequenceSummary}`,
      `  Answer: ${summarizeText(run.answer, 180)}`,
    ].join("\n");
  }).join("\n");
}

export function buildCopilotContextBundle(
  snapshot: CopilotWorkspaceStateSnapshot,
  options?: { maxActions?: number; maxRuns?: number },
): string {
  const nextActions = deriveCopilotNextActions(
    snapshot,
    clampPositiveInteger(options?.maxActions, DEFAULT_MAX_NEXT_ACTIONS, DEFAULT_MAX_PROJECT_ACTIONS),
  );
  const testCommands = listCopilotTestCommands(snapshot);

  return joinSections([
    `Workspace root: ${snapshot.workspaceRoot}`,
    snapshot.profile
      ? [
        "Workspace profile:",
        renderBulletList([
          `Repo type: ${snapshot.profile.repoType}`,
          `Languages: ${snapshot.profile.languages.join(", ") || "unknown"}`,
          `Frameworks: ${snapshot.profile.frameworks.join(", ") || "none detected"}`,
          `Risk areas: ${snapshot.profile.riskAreas.join(", ") || "none detected"}`,
        ]) ?? "",
      ].join("\n")
      : "Workspace profile: no workspace profile is stored yet.",
    snapshot.phase
      ? [
        "Lifecycle phase:",
        renderBulletList([
          `Phase: ${snapshot.phase.phase}`,
          `Confidence: ${Math.round(snapshot.phase.confidence * 100)}%`,
          ...snapshot.phase.reasons.slice(0, 3),
        ]) ?? "",
      ].join("\n")
      : "Lifecycle phase: no lifecycle assessment is stored yet.",
    snapshot.projectMode
      ? `Project mode:\n${formatWorkspaceProjectMode(snapshot.projectMode)}`
      : undefined,
    snapshot.projectMemory
      ? `Project memory summary:\n${snapshot.projectMemory.summary}`
      : "Project memory summary: no extension-owned project memory summary is stored yet.",
    testCommands.length > 0
      ? `Test commands:\n${renderBulletList(testCommands)}`
      : undefined,
    nextActions.length > 0
      ? `Next actions:\n${renderBulletList(nextActions)}`
      : undefined,
    snapshot.suggestions.length > 0
      ? `Suggestion details:\n${formatWorkspaceSuggestions(snapshot.suggestions, clampPositiveInteger(options?.maxActions, DEFAULT_MAX_NEXT_ACTIONS, DEFAULT_MAX_PROJECT_ACTIONS), true)}`
      : undefined,
    snapshot.recentRuns.length > 0
      ? `Recent run summary:\n${formatCopilotRecentRunSummary(snapshot.recentRuns, clampPositiveInteger(options?.maxRuns, DEFAULT_MAX_RECENT_RUNS, DEFAULT_MAX_PROJECT_ACTIONS))}`
      : undefined,
    snapshot.refresh.warnings.length > 0
      ? `Warnings:\n${renderBulletList(snapshot.refresh.warnings)}`
      : undefined,
    snapshot.refresh.lastError ? `Last refresh error: ${snapshot.refresh.lastError}` : undefined,
  ]);
}

export function deriveWorkspaceProjectActionSuggestions(
  snapshot: CopilotWorkspaceStateSnapshot,
  maxActions = DEFAULT_MAX_PROJECT_ACTIONS,
): CopilotProjectActionSuggestion[] {
  const suggestions: CopilotProjectActionSuggestion[] = [];

  for (const command of listCopilotTestCommands(snapshot)) {
    suggestions.push({
      label: command,
      description: "Validation command derived from workspace state.",
      kind: "test",
      source: "workspace-state",
      runnable: false,
    });
  }

  for (const action of snapshot.profile?.likelyActions ?? []) {
    suggestions.push({
      label: action,
      description: "Likely project action derived from the workspace profile.",
      kind: /\btest\b/i.test(action) ? "test" : "workflow",
      source: "workspace-state",
      runnable: false,
    });
  }

  for (const goal of snapshot.projectMemory?.currentGoals ?? []) {
    suggestions.push({
      label: goal,
      description: "Current project goal derived from extension-owned project memory.",
      kind: "goal",
      source: "workspace-state",
      runnable: false,
    });
  }

  for (const milestone of snapshot.projectMode?.milestones ?? []) {
    suggestions.push({
      label: milestone.title,
      description: milestone.reason,
      kind: milestone.source === "validation" ? "test" : milestone.source,
      source: "workspace-state",
      runnable: false,
    });
  }

  const seen = new Set<string>();
  const deduped: CopilotProjectActionSuggestion[] = [];
  for (const suggestion of suggestions) {
    const key = suggestion.label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(suggestion);
    if (deduped.length >= Math.max(1, maxActions)) {
      break;
    }
  }

  return deduped;
}

export function parseDiscoveredProjectActions(result: ToolResult | undefined): BackendDiscoveredProjectAction[] {
  if (!result?.ok) {
    return [];
  }

  const parsed = tryParseJsonContent<unknown>(result);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(isBackendDiscoveredProjectAction)
    .map((action) => ({
      id: action.id,
      description: action.description,
      kind: action.kind,
    }));
}

export function mergeCopilotProjectActions(
  stateActions: readonly CopilotProjectActionSuggestion[],
  backendActions: readonly BackendDiscoveredProjectAction[],
  maxActions = DEFAULT_MAX_PROJECT_ACTIONS,
): CopilotProjectActionSuggestion[] {
  const merged: CopilotProjectActionSuggestion[] = [...stateActions];
  const seen = new Set(stateActions.map((action) => action.label.toLowerCase()));

  for (const action of backendActions) {
    const key = action.id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push({
      label: action.id,
      description: action.description,
      kind: action.kind,
      source: "backend",
      runnable: true,
    });
    if (merged.length >= Math.max(1, maxActions)) {
      break;
    }
  }

  return merged.slice(0, Math.max(1, maxActions));
}
