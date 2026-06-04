/**
 * Registers Agent-Platform's read-only tools with the VS Code language model tool API
 * (vscode.lm.registerTool), making them available to Copilot's native agent mode without
 * requiring the @agent-platform chat participant prefix.
 *
 * Native state tools read from extension-managed workspace/session state first, then optionally
 * enrich from backend read tools when they are available. Destructive and mutation tools remain
 * exclusively under Agent-Platform's approval-gated execution path and are intentionally excluded.
 */

import * as vscode from "vscode";

import {
  buildCopilotContextBundle,
  createWorkspaceSnapshot,
  deriveCopilotNextActions,
  deriveWorkspaceProjectActionSuggestions,
  formatCopilotRecentRunSummary,
  formatPhaseAssessmentSummary,
  formatWorkspaceProfileSummary,
  formatWorkspaceSuggestions,
  joinSections,
  listCopilotTestCommands,
  mergeCopilotProjectActions,
  parseDiscoveredProjectActions,
  renderBulletList,
  DEFAULT_MAX_NEXT_ACTIONS,
  DEFAULT_MAX_PROJECT_ACTIONS,
  DEFAULT_MAX_RECENT_RUNS,
  type BackendDiscoveredProjectAction,
  type CopilotProjectActionSuggestion,
  type CopilotWorkspaceStateSnapshot,
} from "./agent/copilotToolState";
import type { SessionStore } from "./state/sessionStore";
import type { WorkspaceStore } from "./state/workspaceStore";
import { formatToolResult } from "./tools/interface";
import type { ToolProviderRegistry } from "./tools/providerRegistry";

interface SymbolInput {
  name: string;
}

interface FindSymbolInput extends SymbolInput {
  level?: number;
  hints?: boolean;
  compress?: boolean;
}

interface GetDependenciesInput extends SymbolInput {
  max_results?: number;
  compress?: boolean;
}

interface GetChangeImpactInput extends SymbolInput {
  max_direct?: number;
  max_transitive?: number;
}

interface GetNextActionsInput {
  max_actions?: number;
}

interface GetRecentRunSummaryInput {
  max_runs?: number;
}

interface GetContextBundleInput {
  max_actions?: number;
  max_runs?: number;
}

interface DiscoverProjectActionsInput {
  include_backend_actions?: boolean;
}

export interface RegisterCopilotToolsDependencies {
  toolProviderRegistry: ToolProviderRegistry;
  getWorkspaceRoot: () => string | undefined;
  getSessionStore: () => SessionStore;
  getWorkspaceStore: () => WorkspaceStore;
}

function clampPositiveInteger(value: number | undefined, fallback: number, maxValue: number): number {
  if (!Number.isInteger(value) || !value || value < 1) {
    return fallback;
  }

  return Math.min(value, maxValue);
}

function toToolResult(text: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(text),
  ]);
}

function noWorkspace(): vscode.LanguageModelToolResult {
  return toToolResult("No workspace folder is open.");
}

function formatProjectActionSuggestions(actions: readonly CopilotProjectActionSuggestion[]): string {
  if (actions.length === 0) {
    return "No project actions were discovered from workspace state or backend read tools yet.";
  }

  const workspaceStateActions = actions.filter((action) => action.source === "workspace-state");
  const backendActions = actions.filter((action) => action.source === "backend");

  return joinSections([
    workspaceStateActions.length > 0
      ? [
        "Workspace-state suggestions:",
        workspaceStateActions.map((action) => `- ${action.label}${action.description ? ` — ${action.description}` : ""}`).join("\n"),
      ].join("\n")
      : undefined,
    backendActions.length > 0
      ? [
        "Backend-discovered runnable actions:",
        backendActions.map((action) => `- ${action.label}${action.kind ? ` [${action.kind}]` : ""}${action.description ? ` — ${action.description}` : ""}`).join("\n"),
      ].join("\n")
      : undefined,
  ]);
}

async function invokeBackendReadTool(
  toolProviderRegistry: ToolProviderRegistry,
  workspaceRoot: string,
  toolName: string,
  argumentsPayload: Record<string, unknown>,
): Promise<vscode.LanguageModelToolResult> {
  const result = await toolProviderRegistry.routeTool(toolName, argumentsPayload, workspaceRoot);
  const body = formatToolResult(result);
  if (result.ok) {
    return toToolResult(body);
  }

  return toToolResult(joinSections([
    body,
    "This native Copilot tool stayed read-only. State-backed tools such as workspace profile, lifecycle phase, project memory summary, and context bundle remain available even without the backend.",
  ]));
}

async function discoverBackendProjectActions(
  toolProviderRegistry: ToolProviderRegistry,
  workspaceRoot: string,
): Promise<BackendDiscoveredProjectAction[]> {
  const tools = await toolProviderRegistry.listAllTools();
  if (!tools.some((tool) => tool.name === "discover_project_actions")) {
    return [];
  }

  try {
    const result = await toolProviderRegistry.routeTool("discover_project_actions", {}, workspaceRoot);
    return parseDiscoveredProjectActions(result);
  } catch {
    return [];
  }
}

export function registerCopilotTools(
  context: vscode.ExtensionContext,
  dependencies: RegisterCopilotToolsDependencies,
): void {
  const { toolProviderRegistry, getWorkspaceRoot, getSessionStore, getWorkspaceStore } = dependencies;

  function getSnapshot(workspaceRoot: string): CopilotWorkspaceStateSnapshot {
    return createWorkspaceSnapshot(workspaceRoot, getWorkspaceStore(), getSessionStore());
  }

  // find_symbol — locate a symbol (function, class, variable) in the workspace
  context.subscriptions.push(
    vscode.lm.registerTool<FindSymbolInput>(
      "agent-platform_find_symbol",
      {
        invoke: async (options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          return invokeBackendReadTool(toolProviderRegistry, workspaceRoot, "find_symbol", {
            name: options.input.name,
            level: options.input.level ?? 1,
            hints: options.input.hints ?? true,
            compress: options.input.compress ?? false,
          });
        },
      },
    ),
  );

  // get_change_impact — show what breaks if a symbol changes
  context.subscriptions.push(
    vscode.lm.registerTool<GetChangeImpactInput>(
      "agent-platform_get_change_impact",
      {
        invoke: async (options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          return invokeBackendReadTool(toolProviderRegistry, workspaceRoot, "get_change_impact", {
            name: options.input.name,
            max_direct: options.input.max_direct ?? 20,
            max_transitive: options.input.max_transitive ?? 50,
          });
        },
      },
    ),
  );

  // get_dependencies — show what a symbol or module depends on
  context.subscriptions.push(
    vscode.lm.registerTool<GetDependenciesInput>(
      "agent-platform_get_dependencies",
      {
        invoke: async (options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          return invokeBackendReadTool(toolProviderRegistry, workspaceRoot, "get_dependencies", {
            name: options.input.name,
            max_results: options.input.max_results ?? 20,
            compress: options.input.compress ?? false,
          });
        },
      },
    ),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<Record<string, never>>(
      "agent-platform_get_workspace_profile",
      {
        invoke: async (_options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          const snapshot = getSnapshot(workspaceRoot);
          return toToolResult(formatWorkspaceProfileSummary(snapshot.profile, snapshot.refresh));
        },
      },
    ),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<Record<string, never>>(
      "agent-platform_detect_phase",
      {
        invoke: async (_options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          const snapshot = getSnapshot(workspaceRoot);
          return toToolResult(formatPhaseAssessmentSummary(snapshot.phase));
        },
      },
    ),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<GetNextActionsInput>(
      "agent-platform_get_next_actions",
      {
        invoke: async (options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          const snapshot = getSnapshot(workspaceRoot);
          const maxActions = clampPositiveInteger(options.input.max_actions, DEFAULT_MAX_NEXT_ACTIONS, DEFAULT_MAX_PROJECT_ACTIONS);
          if (snapshot.suggestions.length > 0) {
            return toToolResult(`Recommended next actions:\n${formatWorkspaceSuggestions(snapshot.suggestions, maxActions, true)}`);
          }

          const actions = deriveCopilotNextActions(snapshot, maxActions);
          return toToolResult(`Recommended next actions:\n${renderBulletList(actions)}`);
        },
      },
    ),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<GetRecentRunSummaryInput>(
      "agent-platform_get_recent_run_summary",
      {
        invoke: async (options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          const snapshot = getSnapshot(workspaceRoot);
          const summary = formatCopilotRecentRunSummary(
            snapshot.recentRuns,
            clampPositiveInteger(options.input.max_runs, DEFAULT_MAX_RECENT_RUNS, DEFAULT_MAX_PROJECT_ACTIONS),
          );
          return toToolResult(summary);
        },
      },
    ),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<Record<string, never>>(
      "agent-platform_get_project_memory_summary",
      {
        invoke: async (_options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          const snapshot = getSnapshot(workspaceRoot);
          return toToolResult(snapshot.projectMemory?.summary ?? "No extension-owned project memory summary is stored yet.");
        },
      },
    ),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<GetContextBundleInput>(
      "agent-platform_get_context_bundle",
      {
        invoke: async (options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          const snapshot = getSnapshot(workspaceRoot);
          return toToolResult(buildCopilotContextBundle(snapshot, {
            maxActions: options.input.max_actions,
            maxRuns: options.input.max_runs,
          }));
        },
      },
    ),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<Record<string, never>>(
      "agent-platform_list_test_commands",
      {
        invoke: async (_options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          const snapshot = getSnapshot(workspaceRoot);
          const commands = listCopilotTestCommands(snapshot);
          return toToolResult(commands.length > 0
            ? `Available test commands:\n${renderBulletList(commands)}`
            : "No test commands were detected in workspace state yet.");
        },
      },
    ),
  );

  context.subscriptions.push(
    vscode.lm.registerTool<DiscoverProjectActionsInput>(
      "agent-platform_discover_project_actions",
      {
        invoke: async (options, _token) => {
          const workspaceRoot = getWorkspaceRoot();
          if (!workspaceRoot) { return noWorkspace(); }

          const snapshot = getSnapshot(workspaceRoot);
          const stateActions = deriveWorkspaceProjectActionSuggestions(snapshot);
          const includeBackendActions = options.input.include_backend_actions ?? true;
          const backendActions = includeBackendActions
            ? await discoverBackendProjectActions(toolProviderRegistry, workspaceRoot)
            : [];
          const merged = mergeCopilotProjectActions(stateActions, backendActions);
          return toToolResult(formatProjectActionSuggestions(merged));
        },
      },
    ),
  );
}
