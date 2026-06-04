import { isAbsolute, join, relative } from "node:path";
import * as vscode from "vscode";

import { recordPreviewRun } from "../agent/runRecorder";
import {
  AgentRuntime,
  deriveRunFailureMessage,
  deriveRunOutcome,
  deriveToolResultFailureMessage,
  type AgentPreviewResult,
} from "../agent/runtime";
import { createApprovedWorkflowRecord, upsertApprovedWorkflow } from "../agent/projectMode";
import { ToolApprovalDeniedError, ToolRouter } from "../agent/toolRouter";
import { formatTraceEntries } from "../agent/trace";
import { BackendGateway } from "../adapters/tokenSavior/gateway";
import {
  formatToolResult,
  tryParseJsonContent,
  type ServiceHealth,
} from "../adapters/tokenSavior/protocol";
import { extractSymbolLocation, formatToolResult as formatGenericToolResult, tryParseJsonContent as parseGenericJson, type ToolResult } from "../tools/interface";
import { type ToolProviderRegistry } from "../tools/providerRegistry";
import { type ToolPolicyRegistry } from "../policies/toolPolicy";
import { buildMemoryPayloadFromRun, buildMemoryPayloadFromToolResult } from "../policies/memoryPolicy";
import { globalToolPolicyRegistry } from "../policies/toolPolicy";
import type { MemoryCapability } from "../tools/interface";
import type { ApprovalSettings } from "../policies/approvalPolicy";
import type { AutomationSettings } from "../config";
import { ModelProviderRegistry } from "../providers/registry";
import {
  formatStoredPreviewRunBody,
  toPreviewRunListItem,
} from "../state/sessionPresentation";
import { SessionStore, type PreviewRunOutcome } from "../state/sessionStore";
import { TelemetryState } from "../state/telemetryState";
import { WorkspaceStore } from "../state/workspaceStore";
import { BackendStatusBarController } from "../ui/statusBar";
import type { CommandUi, ObservabilityPanelSnapshot } from "../testing/extensionTestHarness";
import { showObservabilityPanel } from "../views/observabilityPanel";
import { buildObservabilityHtml } from "../views/observabilityRenderer";

export interface CommandEnvironment {
  toolProviderRegistry: ToolProviderRegistry;
  policyRegistry: ToolPolicyRegistry;
  /** Optional direct gateway reference — used only for health/restart of the token-savior adapter. */
  gateway?: BackendGateway;
  /** Live resolver for the memory capability — called at run time, not activation time. */
  resolveMemoryCapability?: () => MemoryCapability | undefined;
  statusBar: BackendStatusBarController;
  outputChannel: vscode.OutputChannel;
  ui: CommandUi;
  getWorkspaceRoot(): string | undefined;
  getProviderRegistry(): ModelProviderRegistry;
  getSessionStore(): SessionStore;
  getTelemetryState(): TelemetryState;
  getWorkspaceStore(): WorkspaceStore;
  getApprovalSettings(): ApprovalSettings;
  resolveAutomationSettings?(): AutomationSettings;
  refreshStatus(reason?: string): Promise<ServiceHealth | undefined>;
  refreshProjectContext?(reason?: string): Promise<void> | void;
  recordObservabilityPanel?(snapshot: ObservabilityPanelSnapshot): void;
}

async function showProviderStatus(env: CommandEnvironment): Promise<void> {
  const registry = env.getProviderRegistry();
  const snapshots = await registry.snapshots();
  const lines = [
    `Preferred provider: ${registry.getPreferredKind()}`,
    "",
    ...snapshots.map((snapshot) => {
      const preferred = snapshot.preferred ? " (preferred)" : "";
      const model = snapshot.availability.modelId ? ` · model=${snapshot.availability.modelId}` : "";
      return `- ${snapshot.displayName} [${snapshot.kind}]${preferred}: ${snapshot.availability.status}${model} — ${snapshot.availability.reason}`;
    }),
  ];

  appendToolRun(env.outputChannel, "Provider Status", lines.join("\n"));
  const resolved = await registry.resolvePreferredProvider();
  if (resolved) {
    void env.ui.showInformationMessage(
      `Provider ready: ${resolved.displayName} (${resolved.kind})`,
    );
    return;
  }

  void env.ui.showWarningMessage(
    "No model provider is currently available. Use the provider status output for details.",
  );
}

function formatAgentPreviewBody(result: AgentPreviewResult): string {
  const sections = [
    `Query: ${result.query}`,
    `Mode: ${result.mode ?? "preview"}`,
    `Plan source: ${result.plan.source}`,
    `Plan reasoning: ${result.plan.reasoning}`,
    `Provider: ${result.providerKind ?? "none"}`,
  ];

  if (result.plan.kind === "tool") {
    sections.push(
      `Tool: ${result.plan.toolName}`,
      `Arguments: ${JSON.stringify(result.plan.arguments)}`,
    );
  }

  if ((result.plans?.length ?? 0) > 1) {
    sections.push(`Tool sequence: ${result.plans?.filter((plan) => plan.kind === "tool").map((plan) => plan.toolName).join(" -> ")}`);
  }

  sections.push("", "Answer:", result.answer);

  if (result.toolResult) {
    sections.push("", "Raw tool result:", formatToolResult(result.toolResult));
  }

  sections.push("", "Trace:", formatTraceEntries(result.trace));

  return sections.join("\n");
}

function appendToolRun(channel: vscode.OutputChannel, title: string, body: string): void {
  channel.appendLine(`=== ${title} ===`);
  channel.appendLine(body);
  channel.appendLine("");
  channel.show(true);
}

function summarizeBody(body: string, maxLength = 120): string {
  const singleLine = body.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 1)}…`;
}

async function syncWorkspaceContinuationState(
  env: CommandEnvironment,
  input: {
    title: string;
    toolName: string;
    body: string;
    ok: boolean;
    activeFilePath?: string;
  },
): Promise<void> {
  const policy = env.policyRegistry.resolve(input.toolName);
  if (policy.safetyClass === "read" || policy.safetyClass === "memory") {
    return;
  }

  const timestamp = new Date().toISOString();
  try {
    const workflow = createApprovedWorkflowRecord({
      query: input.title,
      toolSequence: [input.toolName],
      summary: summarizeBody(input.body, 220),
      outcome: input.ok ? "completed" : "failed",
      startedAt: timestamp,
      completedAt: timestamp,
      activeFilePath: input.activeFilePath,
    });
    await env.getWorkspaceStore().saveWorkspaceProjectMode(
      upsertApprovedWorkflow(env.getWorkspaceStore().getWorkspaceProjectMode(), workflow, timestamp),
    );
    await env.refreshProjectContext?.(`${input.toolName} completed`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    env.outputChannel.appendLine(`[project-mode] Failed to sync continuation state after ${input.toolName}: ${message}`);
  }
}

function showStoredPreviewRun(
  env: CommandEnvironment,
  run: ReturnType<SessionStore["getLastPreviewRun"]>,
  title: string,
): void {
  appendToolRun(env.outputChannel, title, formatStoredPreviewRunBody(run));
  if (!run) {
    void env.ui.showWarningMessage(
      "No preview agent run is available yet in this session.",
    );
    return;
  }

  void env.ui.showInformationMessage(
    `Showing preview run: ${summarizeBody(run.query)}`,
  );
}

function getSeedInputFromEditor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return undefined;
  }

  const text = editor.document.getText(editor.selection).trim();
  return text.length > 0 ? text : undefined;
}

function getActiveEditorFilePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath;
}

function getRequiredSelectedText(): string | undefined {
  return getSeedInputFromEditor();
}

function toWorkspaceRelativePath(workspaceRoot: string, filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }

  return isAbsolute(filePath) ? relative(workspaceRoot, filePath) : filePath;
}

async function requestToolApproval(
  ui: CommandUi,
  title: string,
  summary: string | undefined,
  reason: string,
): Promise<boolean> {
  const choice = await ui.showWarningMessage(
    `${title} requires confirmation before it runs.`,
    {
      modal: true,
      detail: [reason, summary].filter(Boolean).join("\n\n"),
    },
    "Approve",
  );
  return choice === "Approve";
}

function createToolRouter(env: CommandEnvironment, workspaceRoot: string): ToolRouter {
  return new ToolRouter({
    toolProviderRegistry: env.toolProviderRegistry,
    policyRegistry: env.policyRegistry,
    workspaceRoot,
    getApprovalSettings: env.getApprovalSettings,
    isWorkspaceTrusted: () => vscode.workspace.isTrusted,
    requestApproval: (request) => requestToolApproval(env.ui, request.title, request.summary, request.reason),
    onToolCompleted: async (toolName, result) => {
      const settings = env.getApprovalSettings();
      const policy = env.policyRegistry.resolve(toolName);
      if (!settings.autoSaveProjectMemory || !policy.mutatesWorkspace || toolName === "memory_save") {
        return;
      }

      const payload = buildMemoryPayloadFromToolResult(`${policy.title} result`, result);
      await env.toolProviderRegistry.routeTool("memory_save", payload, workspaceRoot);
    },
  });
}

function createActionRuntimeToolExecutor(
  env: CommandEnvironment,
  workspaceRoot: string,
  query: string,
): { invokeTool(workspaceRoot: string, name: string, argumentsPayload: Record<string, unknown>): Promise<ToolResult> } {
  const router = createToolRouter(env, workspaceRoot);
  return {
    invokeTool: async (_root, name, argumentsPayload) => router.invokeTool({
      toolName: name,
      title: `Action Agent: ${env.policyRegistry.resolve(name).title}`,
      argumentsPayload,
      approvalSummary: [
        `User request: ${query}`,
        `Tool: ${name}`,
        `Arguments: ${JSON.stringify(argumentsPayload)}`,
      ].join("\n"),
    }),
  };
}

function extractCheckpointId(result: ToolResult): string | undefined {
  const payload = parseGenericJson<Record<string, unknown>>(result);
  return typeof payload?.checkpoint_id === "string"
    ? payload.checkpoint_id
    : typeof payload?.checkpoint === "object" && payload.checkpoint && "checkpoint_id" in payload.checkpoint
      ? String((payload.checkpoint as { checkpoint_id?: unknown }).checkpoint_id)
      : undefined;
}

async function persistCheckpointFromResult(
  env: CommandEnvironment,
  result: ToolResult | undefined,
  filePath?: string,
): Promise<void> {
  if (!result) {
    return;
  }

  const checkpointId = extractCheckpointId(result);
  if (!checkpointId) {
    return;
  }

  await env.getWorkspaceStore().saveLastCheckpoint({
    checkpointId,
    createdAt: new Date().toISOString(),
    filePath,
  });
}

async function promptForSymbolName(
  env: CommandEnvironment,
  prompt: string,
  placeHolder: string,
): Promise<string | undefined> {
  const name = await env.ui.showInputBox({
    prompt,
    placeHolder,
    value: getSeedInputFromEditor(),
    ignoreFocusOut: true,
  });
  return name?.trim() ? name.trim() : undefined;
}

async function revealSymbolLocation(
  workspaceRoot: string,
  result: ToolResult,
): Promise<void> {
  const location = extractSymbolLocation(result);
  if (!location) {
    return;
  }

  const filePath = isAbsolute(location.file) ? location.file : join(workspaceRoot, location.file);
  const document = await vscode.workspace.openTextDocument(filePath);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const lineNumber = Math.max((location.line ?? 1) - 1, 0);
  const position = new vscode.Position(lineNumber, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

async function runToolCommand(
  env: CommandEnvironment,
  title: string,
  toolName: string,
  argumentsPayload: Record<string, unknown> = {},
  options?: { activeFilePath?: string },
): Promise<ToolResult | undefined> {
  const workspaceRoot = env.getWorkspaceRoot();
  if (!workspaceRoot) {
    env.statusBar.setIdle("Open a workspace folder to run backend commands.");
    void env.ui.showWarningMessage(
      "Open a workspace folder before running Agent-Platform commands.",
    );
    return undefined;
  }

  env.statusBar.setStarting(`${title}…`);

  try {
    const router = createToolRouter(env, workspaceRoot);
    const result = await router.invokeTool({
      toolName,
      title,
      argumentsPayload,
      approvalSummary: `Tool: ${toolName}\nArguments: ${JSON.stringify(argumentsPayload)}`,
    });
    const body = formatGenericToolResult(result);
    appendToolRun(env.outputChannel, title, body);
    await syncWorkspaceContinuationState(env, {
      title,
      toolName,
      body,
      ok: !deriveToolResultFailureMessage(result),
      activeFilePath: options?.activeFilePath,
    });

    const failureMessage = deriveToolResultFailureMessage(result);
    if (failureMessage) {
      env.statusBar.setError(failureMessage);
      void env.ui.showErrorMessage(`${title} failed: ${failureMessage}`);
      return result;
    }

    env.statusBar.setReady(env.gateway?.getLastHealth(), `${title} complete.`);
    void env.ui.showInformationMessage(`${title} complete: ${summarizeBody(body)}`);
    return result;
  } catch (error) {
    if (error instanceof ToolApprovalDeniedError) {
      env.statusBar.setIdle(`${title} cancelled.`);
      void env.ui.showInformationMessage(`${title} was cancelled before execution.`);
      return undefined;
    }

    const message = error instanceof Error ? error.message : String(error);
    env.statusBar.setError(message);
    void env.ui.showErrorMessage(`${title} failed: ${message}`);
    return undefined;
  }
}

async function beginTrackedRun(
  env: CommandEnvironment,
  record: {
    id: string;
    query: string;
    mode: "preview" | "action";
    source: "chat" | "command";
    startedAt: string;
    activeFilePath?: string;
  },
): Promise<void> {
  await env.getWorkspaceStore().saveActiveRun(record);
}

async function completeTrackedRun(
  env: CommandEnvironment,
  workspaceRoot: string,
  input: {
    id: string;
    query: string;
    result: AgentPreviewResult;
    source: "chat" | "command";
    activeFilePath?: string;
    startedAt: string;
    durationMs: number;
    outcome?: PreviewRunOutcome;
  },
) {
  const recorded = await recordPreviewRun({
    toolProviderRegistry: env.toolProviderRegistry,
    sessionStore: env.getSessionStore(),
    workspaceRoot,
    getApprovalSettings: env.getApprovalSettings,
  }, {
    id: input.id,
    query: input.query,
    result: input.result,
    source: input.source,
    activeFilePath: input.activeFilePath,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    outcome: input.outcome ?? "completed",
  });
  await env.getTelemetryState().recordRun(recorded.run);
  await env.getWorkspaceStore().clearActiveRun();
  return recorded;
}

function getRecordedRunFailureMessage(result: AgentPreviewResult): string {
  return deriveRunFailureMessage(result) ?? "Agent-Platform received a failed backend tool result.";
}

async function failTrackedRun(
  env: CommandEnvironment,
  input: {
    mode: "preview" | "action";
    source: "chat" | "command";
    startedMs: number;
    outcome: "failed" | "cancelled";
    message?: string;
  },
): Promise<void> {
  await env.getTelemetryState().recordRunEvent({
    mode: input.mode,
    source: input.source,
    outcome: input.outcome,
    durationMs: Date.now() - input.startedMs,
    toolCallCount: 0,
    finishedAt: new Date().toISOString(),
    errorMessage: input.message,
  });
  await env.getWorkspaceStore().clearActiveRun();
}

export function registerCommands(
  context: vscode.ExtensionContext,
  env: CommandEnvironment,
): void {
  const pingCommand = vscode.commands.registerCommand(
    "agentPlatform.pingBackend",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        env.statusBar.setIdle("Open a workspace folder to connect.");
        void env.ui.showWarningMessage(
          "Open a workspace folder before starting the Agent-Platform backend.",
        );
        return;
      }

      try {
        const health = await env.refreshStatus("manual ping");
        if (!health) {
          return;
        }

        void env.ui.showInformationMessage(
          `Agent-Platform backend reachable: v${health.version} · profile=${health.profile} · capabilities=${health.capability_count} · projects=${health.project_count}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        env.statusBar.setError(message);
        void env.ui.showErrorMessage(`Agent-Platform backend ping failed: ${message}`);
      }
    },
  );

  const restartCommand = vscode.commands.registerCommand(
    "agentPlatform.restartBackend",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        env.statusBar.setIdle("Open a workspace folder to restart the backend.");
        void env.ui.showWarningMessage(
          "Open a workspace folder before restarting the Agent-Platform backend.",
        );
        return;
      }

      env.statusBar.setStarting("Restarting backend…");
      try {
        const health = await env.gateway?.restart(workspaceRoot);
        if (!health) {
          env.statusBar.setIdle("Backend stopped.");
          return;
        }

        await env.getTelemetryState().recordBackendRestart();
        env.statusBar.setReady(health, "Backend restarted.");
        void env.ui.showInformationMessage(
          `Agent-Platform backend restarted: v${health.version} · profile=${health.profile}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        env.statusBar.setError(message);
        void env.ui.showErrorMessage(`Agent-Platform backend restart failed: ${message}`);
      }
    },
  );

  const projectSummaryCommand = vscode.commands.registerCommand(
    "agentPlatform.projectSummary",
    async () => {
      await runToolCommand(env, "Project Summary", "get_project_summary");
    },
  );

  const analyzeCurrentSymbolCommand = vscode.commands.registerCommand(
    "agentPlatform.analyzeCurrentSymbol",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        env.statusBar.setIdle("Open a workspace folder to analyze symbols.");
        void env.ui.showWarningMessage(
          "Open a workspace folder before running Agent-Platform commands.",
        );
        return;
      }

      const name = await promptForSymbolName(
        env,
        "Enter the symbol name to analyze",
        "Example: TokenSaviorService.invoke_tool",
      );
      if (!name) {
        return;
      }

      const result = await runToolCommand(env, "Analyze Current Symbol", "get_full_context", {
        name,
        depth: 2,
        mode: "compact",
        max_lines: 200,
      });
      if (result?.ok) {
        await revealSymbolLocation(workspaceRoot, result);
      }
    },
  );

  const findSymbolCommand = vscode.commands.registerCommand(
    "agentPlatform.findSymbol",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        env.statusBar.setIdle("Open a workspace folder to find symbols.");
        void env.ui.showWarningMessage(
          "Open a workspace folder before running Agent-Platform commands.",
        );
        return;
      }

      const name = await env.ui.showInputBox({
        prompt: "Enter the symbol name to locate",
        placeHolder: "Example: TokenSaviorService.invoke_tool",
        value: getSeedInputFromEditor(),
        ignoreFocusOut: true,
      });
      if (!name || name.trim().length === 0) {
        return;
      }

      const result = await runToolCommand(env, "Find Symbol", "find_symbol", {
        name: name.trim(),
        level: 1,
        hints: true,
        compress: false,
      });
      if (result?.ok) {
        await revealSymbolLocation(workspaceRoot, result);
      }
    },
  );

  const searchMemoryCommand = vscode.commands.registerCommand(
    "agentPlatform.searchMemory",
    async () => {
      const query = await env.ui.showInputBox({
        prompt: "Search project memory",
        placeHolder: "Example: service api transport",
        value: getSeedInputFromEditor(),
        ignoreFocusOut: true,
      });
      if (!query || query.trim().length === 0) {
        return;
      }

      await runToolCommand(env, "Search Project Memory", "memory_search", {
        query: query.trim(),
        limit: 10,
      });
    },
  );

  const reindexWorkspaceCommand = vscode.commands.registerCommand(
    "agentPlatform.reindexWorkspace",
    async () => {
      await runToolCommand(env, "Reindex Workspace", "reindex", {});
    },
  );

  const discoverProjectActionsCommand = vscode.commands.registerCommand(
    "agentPlatform.discoverProjectActions",
    async () => {
      await runToolCommand(env, "Discover Project Actions", "discover_project_actions", {});
    },
  );

  const runProjectActionCommand = vscode.commands.registerCommand(
    "agentPlatform.runProjectAction",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        void env.ui.showWarningMessage("Open a workspace folder before running project actions.");
        return;
      }

      const router = createToolRouter(env, workspaceRoot);
      const available = await router.invokeTool({ toolName: "discover_project_actions", title: "Discover Project Actions" });
      const actions = tryParseJsonContent<Array<{ id: string; description?: string; kind?: string }>>(available) ?? [];
      if (actions.length === 0) {
        appendToolRun(env.outputChannel, "Project Actions", formatToolResult(available));
        void env.ui.showWarningMessage("No runnable project actions were discovered.");
        return;
      }

      const selection = await env.ui.showQuickPick(
        actions.map((action) => ({ label: action.id, description: action.kind, detail: action.description })),
        { placeHolder: "Select a project action to run", ignoreFocusOut: true },
      );
      if (!selection) {
        return;
      }

      const result = await runToolCommand(env, `Run Project Action (${selection.label})`, "run_project_action", {
        action_id: selection.label,
        include_output: true,
      });
      if (!result?.ok) {
        return;
      }
    },
  );

  const runImpactedTestsCommand = vscode.commands.registerCommand(
    "agentPlatform.runImpactedTests",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        void env.ui.showWarningMessage("Open a workspace folder before running impacted tests.");
        return;
      }

      const selectedText = getSeedInputFromEditor();
      const activeFilePath = toWorkspaceRelativePath(workspaceRoot, getActiveEditorFilePath());
      const symbolName = selectedText?.trim() || await promptForSymbolName(
        env,
        "Optional symbol name to focus the impacted-test run",
        "Leave empty to use the active file when available",
      );

      const payload: Record<string, unknown> = {
        include_output: true,
        compact: false,
      };
      if (symbolName) {
        payload.symbol_names = [symbolName];
      } else if (activeFilePath) {
        payload.changed_files = [activeFilePath];
      }

      await runToolCommand(env, "Run Impacted Tests", "run_impacted_tests", payload, {
        activeFilePath,
      });
    },
  );

  const applySelectedTextToSymbolCommand = vscode.commands.registerCommand(
    "agentPlatform.applySelectedTextToSymbol",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        void env.ui.showWarningMessage("Open a workspace folder before applying symbol changes.");
        return;
      }

      const newSource = getRequiredSelectedText();
      if (!newSource) {
        void env.ui.showWarningMessage("Select the replacement source text in the editor before applying a symbol change.");
        return;
      }

      const symbolName = await promptForSymbolName(
        env,
        "Enter the symbol name that should be replaced with the selected text",
        "Example: TokenSaviorService.invoke_tool",
      );
      if (!symbolName) {
        return;
      }

      const filePath = toWorkspaceRelativePath(workspaceRoot, getActiveEditorFilePath());
      const result = await runToolCommand(env, "Apply Symbol Change", "apply_symbol_change_and_validate", {
        symbol_name: symbolName,
        new_source: newSource,
        file_path: filePath,
        rollback_on_failure: true,
        include_output: true,
        compact: false,
      }, {
        activeFilePath: filePath,
      });
      if (!result) {
        return;
      }

      await persistCheckpointFromResult(env, result, filePath);
    },
  );

  const listCheckpointsCommand = vscode.commands.registerCommand(
    "agentPlatform.listCheckpoints",
    async () => {
      await runToolCommand(env, "List Checkpoints", "list_checkpoints", {});
    },
  );

  const restoreCheckpointCommand = vscode.commands.registerCommand(
    "agentPlatform.restoreCheckpoint",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        void env.ui.showWarningMessage("Open a workspace folder before restoring checkpoints.");
        return;
      }

      const router = createToolRouter(env, workspaceRoot);
      const listed = await router.invokeTool({ toolName: "list_checkpoints", title: "List Checkpoints" });
      const checkpoints = tryParseJsonContent<Array<Record<string, unknown>>>(listed) ?? [];
      let checkpointId: string | undefined;
      if (checkpoints.length > 0) {
        const selection = await env.ui.showQuickPick(
          checkpoints.map((item) => ({
            label: String(item.checkpoint_id ?? item.id ?? "unknown"),
            description: String(item.created_at ?? item.timestamp ?? ""),
            detail: JSON.stringify(item),
          })),
          { placeHolder: "Select a checkpoint to restore", ignoreFocusOut: true },
        );
        checkpointId = selection?.label;
      }

      if (!checkpointId) {
        checkpointId = await env.ui.showInputBox({
          prompt: "Enter the checkpoint id to restore",
          value: env.getWorkspaceStore().getLastCheckpoint()?.checkpointId,
          ignoreFocusOut: true,
        });
      }
      if (!checkpointId?.trim()) {
        return;
      }

      await runToolCommand(env, `Restore Checkpoint (${checkpointId.trim()})`, "restore_checkpoint", {
        checkpoint_id: checkpointId.trim(),
      });
    },
  );

  const restoreLastCheckpointCommand = vscode.commands.registerCommand(
    "agentPlatform.restoreLastCheckpoint",
    async () => {
      const record = env.getWorkspaceStore().getLastCheckpoint();
      if (!record) {
        void env.ui.showWarningMessage("No checkpoint has been recorded in workspace state yet.");
        return;
      }

      await runToolCommand(env, `Restore Last Checkpoint (${record.checkpointId})`, "restore_checkpoint", {
        checkpoint_id: record.checkpointId,
      });
    },
  );

  const showDependenciesCommand = vscode.commands.registerCommand(
    "agentPlatform.showDependencies",
    async () => {
      const name = await promptForSymbolName(
        env,
        "Enter the symbol name to inspect dependencies",
        "Example: TokenSaviorService.invoke_tool",
      );
      if (!name) {
        return;
      }

      await runToolCommand(env, "Show Dependencies", "get_dependencies", {
        name,
        max_results: 20,
        compress: false,
      });
    },
  );

  const showChangeImpactCommand = vscode.commands.registerCommand(
    "agentPlatform.showChangeImpact",
    async () => {
      const name = await promptForSymbolName(
        env,
        "Enter the symbol name to analyze change impact",
        "Example: TokenSaviorService.invoke_tool",
      );
      if (!name) {
        return;
      }

      await runToolCommand(env, "Show Change Impact", "get_change_impact", {
        name,
        max_direct: 20,
        max_transitive: 50,
      });
    },
  );

  const providerStatusCommand = vscode.commands.registerCommand(
    "agentPlatform.showProviderStatus",
    async () => {
      await showProviderStatus(env);
    },
  );

  const agentPreviewCommand = vscode.commands.registerCommand(
    "agentPlatform.askAgentPreview",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        env.statusBar.setIdle("Open a workspace folder to use the preview agent.");
        void env.ui.showWarningMessage(
          "Open a workspace folder before running the Agent-Platform preview agent.",
        );
        return;
      }

      const selectedText = getSeedInputFromEditor();
      const query = await env.ui.showInputBox({
        prompt: "Ask the Agent-Platform preview agent",
        placeHolder: "Example: What is this project about? or Find symbol TokenSaviorService.invoke_tool",
        value: selectedText,
        ignoreFocusOut: true,
      });
      if (!query || query.trim().length === 0) {
        return;
      }

      env.statusBar.setStarting("Running preview agent…");
      const runId = `${Date.now()}`;
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      await beginTrackedRun(env, {
        id: runId,
        query: query.trim(),
        mode: "preview",
        source: "command",
        startedAt,
        activeFilePath: getActiveEditorFilePath(),
      });
      try {
        const runtime = new AgentRuntime({
          workspaceRoot,
          providerRegistry: env.getProviderRegistry(),
          sessionStore: env.getSessionStore(),
          listTools: () => env.toolProviderRegistry.listAllTools(),
          resolveMemoryCapability: env.resolveMemoryCapability,
          resolveAutomationSettings: env.resolveAutomationSettings,
          resolveWorkspaceProfile: () => env.getWorkspaceStore().getWorkspaceProfile(),
          resolveWorkspacePhase: () => env.getWorkspaceStore().getWorkspacePhase(),
          resolveWorkspaceRefreshState: () => env.getWorkspaceStore().getWorkspaceRefreshState(),
          resolveWorkspaceProjectMode: () => env.getWorkspaceStore().getWorkspaceProjectMode(),
          resolveWorkspaceProjectMemory: () => env.getWorkspaceStore().getWorkspaceProjectMemory(),
          resolveWorkspaceSuggestions: () => env.getWorkspaceStore().getWorkspaceSuggestions(),
          resolveWorkspaceProjectMemorySummary: () => env.getWorkspaceStore().getWorkspaceProjectMemory()?.summary,
          toolExecutor: {
            invokeTool: (root, name, argumentsPayload) => env.toolProviderRegistry.routeTool(name, argumentsPayload, root),
          },
        });
        const result = await runtime.runPreview({
          query: query.trim(),
          selectedText,
          activeFilePath: getActiveEditorFilePath(),
        });
        const outcome = deriveRunOutcome(result);
        const recorded = await completeTrackedRun(env, workspaceRoot, {
          id: runId,
          query: result.query,
          result,
          source: "command",
          activeFilePath: getActiveEditorFilePath(),
          startedAt,
          durationMs: Date.now() - startedMs,
          outcome,
        });

        appendToolRun(env.outputChannel, "Agent Preview", formatAgentPreviewBody(recorded.run.result));
        if (recorded.memoryStatus.state === "failed") {
          appendToolRun(env.outputChannel, "Agent Preview Memory", recorded.memoryStatus.reason);
        }

        if (outcome === "failed") {
          const failureMessage = getRecordedRunFailureMessage(recorded.run.result);
          env.statusBar.setError(failureMessage);
          void env.ui.showErrorMessage(`Agent-Platform preview agent failed: ${failureMessage}`);
          return;
        }

        env.statusBar.setReady(env.gateway?.getLastHealth(), "Preview agent complete.");
        const autoSaveSuffix = recorded.memoryStatus.state === "saved"
          ? " Saved to project memory automatically."
          : "";
        void env.ui.showInformationMessage(`Agent preview complete: ${summarizeBody(result.answer)}${autoSaveSuffix}`);

        if (result.plan.kind === "tool" && result.plan.toolName === "find_symbol" && result.toolResult?.ok) {
          await revealSymbolLocation(workspaceRoot, result.toolResult);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await failTrackedRun(env, {
          mode: "preview",
          source: "command",
          startedMs,
          outcome: "failed",
          message,
        });
        env.statusBar.setError(message);
        void env.ui.showErrorMessage(`Agent-Platform preview agent failed: ${message}`);
      }
    },
  );

  const agentActionCommand = vscode.commands.registerCommand(
    "agentPlatform.askAgentAction",
    async () => {
      const workspaceRoot = env.getWorkspaceRoot();
      if (!workspaceRoot) {
        env.statusBar.setIdle("Open a workspace folder to use the action agent.");
        void env.ui.showWarningMessage(
          "Open a workspace folder before running the Agent-Platform action agent.",
        );
        return;
      }

      const selectedText = getSeedInputFromEditor();
      const activeFilePath = toWorkspaceRelativePath(workspaceRoot, getActiveEditorFilePath());
      const query = await env.ui.showInputBox({
        prompt: "Ask the Agent-Platform action agent",
        placeHolder: "Example: Apply the selected text to TokenSaviorService.invoke_tool and validate, or Run impacted tests for TokenSaviorService",
        ignoreFocusOut: true,
      });
      if (!query || query.trim().length === 0) {
        return;
      }

      env.statusBar.setStarting("Running action agent…");
      const runId = `action-${Date.now()}`;
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      await beginTrackedRun(env, {
        id: runId,
        query: query.trim(),
        mode: "action",
        source: "command",
        startedAt,
        activeFilePath,
      });
      try {
        const runtime = new AgentRuntime({
          workspaceRoot,
          providerRegistry: env.getProviderRegistry(),
          sessionStore: env.getSessionStore(),
          listTools: () => env.toolProviderRegistry.listAllTools(),
          resolveMemoryCapability: env.resolveMemoryCapability,
          resolveAutomationSettings: env.resolveAutomationSettings,
          resolveWorkspaceProfile: () => env.getWorkspaceStore().getWorkspaceProfile(),
          resolveWorkspacePhase: () => env.getWorkspaceStore().getWorkspacePhase(),
          resolveWorkspaceRefreshState: () => env.getWorkspaceStore().getWorkspaceRefreshState(),
          resolveWorkspaceProjectMode: () => env.getWorkspaceStore().getWorkspaceProjectMode(),
          resolveWorkspaceProjectMemory: () => env.getWorkspaceStore().getWorkspaceProjectMemory(),
          resolveWorkspaceSuggestions: () => env.getWorkspaceStore().getWorkspaceSuggestions(),
          resolveWorkspaceProjectMemorySummary: () => env.getWorkspaceStore().getWorkspaceProjectMemory()?.summary,
          toolExecutor: createActionRuntimeToolExecutor(env, workspaceRoot, query.trim()),
        });
        const result = await runtime.runAction({
          query: query.trim(),
          selectedText,
          activeFilePath,
          maxToolSteps: 3,
        });
        const outcome = deriveRunOutcome(result);
        const recorded = await completeTrackedRun(env, workspaceRoot, {
          id: runId,
          query: result.query,
          result,
          source: "command",
          activeFilePath,
          startedAt,
          durationMs: Date.now() - startedMs,
          outcome,
        });

        appendToolRun(env.outputChannel, "Agent Action", formatAgentPreviewBody(recorded.run.result));
        if (recorded.run.result.toolResults) {
          for (const toolResult of recorded.run.result.toolResults) {
            await persistCheckpointFromResult(env, toolResult, activeFilePath);
          }
        }
        await env.refreshProjectContext?.("action run completed");
        if (recorded.memoryStatus.state === "failed") {
          appendToolRun(env.outputChannel, "Agent Action Memory", recorded.memoryStatus.reason);
        }

        if (outcome === "failed") {
          const failureMessage = getRecordedRunFailureMessage(recorded.run.result);
          env.statusBar.setError(failureMessage);
          void env.ui.showErrorMessage(`Agent-Platform action agent failed: ${failureMessage}`);
          return;
        }

        env.statusBar.setReady(env.gateway?.getLastHealth(), "Action agent complete.");
        const autoSaveSuffix = recorded.memoryStatus.state === "saved"
          ? " Saved to project memory automatically."
          : "";
        void env.ui.showInformationMessage(`Action agent complete: ${summarizeBody(result.answer)}${autoSaveSuffix}`);

        if (result.plan.kind === "tool" && result.plan.toolName === "find_symbol" && result.toolResult?.ok) {
          await revealSymbolLocation(workspaceRoot, result.toolResult);
        }
      } catch (error) {
        if (error instanceof ToolApprovalDeniedError) {
          await failTrackedRun(env, {
            mode: "action",
            source: "command",
            startedMs,
            outcome: "cancelled",
          });
          env.statusBar.setIdle("Action agent cancelled.");
          void env.ui.showInformationMessage("Agent-Platform action agent was cancelled before execution.");
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        await failTrackedRun(env, {
          mode: "action",
          source: "command",
          startedMs,
          outcome: "failed",
          message,
        });
        env.statusBar.setError(message);
        void env.ui.showErrorMessage(`Agent-Platform action agent failed: ${message}`);
      }
    },
  );

  const observabilityDashboardCommand = vscode.commands.registerCommand(
    "agentPlatform.showObservabilityDashboard",
    async (runId?: string) => {
      showObservabilityPanel(
        context,
        env.getSessionStore(),
        env.getTelemetryState().getSnapshot(),
        runId,
        env.getWorkspaceStore().getLastCheckpoint(),
        env.getWorkspaceStore().getWorkspaceProfile(),
        env.getWorkspaceStore().getWorkspacePhase(),
        env.getWorkspaceStore().getWorkspaceRefreshState(),
        env.getWorkspaceStore().getWorkspaceProjectMode(),
        env.getWorkspaceStore().getWorkspaceProjectMemory(),
        env.resolveAutomationSettings?.(),
        env.getWorkspaceStore().getWorkspaceSuggestions(),
        env.recordObservabilityPanel,
      );
    },
  );

  const lastAgentTraceCommand = vscode.commands.registerCommand(
    "agentPlatform.showLastAgentTrace",
    async () => {
      const run = env.getSessionStore().getLastPreviewRun();
      showStoredPreviewRun(env, run, "Last Agent Trace");
    },
  );

  const showStoredAgentRunCommand = vscode.commands.registerCommand(
    "agentPlatform.showStoredAgentRun",
    async (runId?: string) => {
      const run = typeof runId === "string"
        ? env.getSessionStore().getPreviewRun(runId)
        : env.getSessionStore().getLastPreviewRun();
      showStoredPreviewRun(env, run, "Stored Agent Run");
    },
  );

  const agentRunHistoryCommand = vscode.commands.registerCommand(
    "agentPlatform.showAgentRunHistory",
    async () => {
      const runs = env.getSessionStore().listPreviewRuns();
      if (runs.length === 0) {
        appendToolRun(
          env.outputChannel,
          "Agent Run History",
          "No preview agent runs have been recorded in this session yet.",
        );
        void env.ui.showWarningMessage(
          "No preview agent history is available yet in this session.",
        );
        return;
      }

      const selection = await env.ui.showQuickPick(
        runs.map((run) => toPreviewRunListItem(run)),
        {
          placeHolder: "Select a preview run to inspect",
          ignoreFocusOut: true,
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );
      if (!selection) {
        return;
      }

      const run = env.getSessionStore().getPreviewRun(selection.runId);
      showStoredPreviewRun(env, run, "Agent Run History");
    },
  );

  const clearAgentRunHistoryCommand = vscode.commands.registerCommand(
    "agentPlatform.clearAgentRunHistory",
    async () => {
      const runs = env.getSessionStore().listPreviewRuns();
      if (runs.length === 0) {
        void env.ui.showInformationMessage(
          "Preview agent history is already empty.",
        );
        return;
      }

      const confirmation = await env.ui.showWarningMessage(
        `Clear ${runs.length} preview run${runs.length === 1 ? "" : "s"} from this session?`,
        { modal: true },
        "Clear History",
      );
      if (confirmation !== "Clear History") {
        return;
      }

      env.getSessionStore().clear();
      appendToolRun(env.outputChannel, "Agent Run History", "Cleared preview agent history for this session.");
      void env.ui.showInformationMessage("Cleared preview agent history for this session.");
    },
  );

  const saveLastRunToMemoryCommand = vscode.commands.registerCommand(
    "agentPlatform.saveLastRunToMemory",
    async () => {
      const run = env.getSessionStore().getLastPreviewRun();
      if (!run) {
        void env.ui.showWarningMessage("No preview run is available to save into project memory yet.");
        return;
      }

      const result = await runToolCommand(env, "Save Last Run to Memory", "memory_save", buildMemoryPayloadFromRun(run));
      if (!result?.ok) {
        return;
      }

      env.getSessionStore().updatePreviewRun(run.id, (current) => ({
        ...current,
        memoryStatus: {
          state: "manual",
          reason: "Saved to project memory explicitly from the command palette.",
          savedAt: new Date().toISOString(),
        },
      }));
    },
  );

  const promoteProjectMemoryCommand = vscode.commands.registerCommand(
    "agentPlatform.promoteProjectMemory",
    async () => {
      await runToolCommand(env, "Promote Project Memory", "memory_maintain", {
        action: "promote",
        dry_run: false,
      });
    },
  );

  const testCommands: vscode.Disposable[] = [];
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    testCommands.push(
      vscode.commands.registerCommand(
        "agentPlatform.test.persistCheckpointFromToolResult",
        async (input: { result: ToolResult; filePath?: string }) => {
          await persistCheckpointFromResult(env, input.result, input.filePath);
          return env.getWorkspaceStore().getLastCheckpoint();
        },
      ),
      vscode.commands.registerCommand(
        "agentPlatform.test.getLastCheckpoint",
        () => env.getWorkspaceStore().getLastCheckpoint(),
      ),
      vscode.commands.registerCommand(
        "agentPlatform.test.renderObservabilityHtml",
        (runId?: string) => buildObservabilityHtml(
          env.getSessionStore(),
          env.getTelemetryState().getSnapshot(),
          runId,
          env.getWorkspaceStore().getLastCheckpoint(),
          env.getWorkspaceStore().getWorkspaceProfile(),
          env.getWorkspaceStore().getWorkspacePhase(),
          env.getWorkspaceStore().getWorkspaceRefreshState(),
          env.getWorkspaceStore().getWorkspaceProjectMode(),
          env.getWorkspaceStore().getWorkspaceProjectMemory(),
          env.resolveAutomationSettings?.(),
          env.getWorkspaceStore().getWorkspaceSuggestions(),
        ),
      ),
      vscode.commands.registerCommand(
        "agentPlatform.test.getWorkspaceProfile",
        () => env.getWorkspaceStore().getWorkspaceProfile(),
      ),
      vscode.commands.registerCommand(
        "agentPlatform.test.getWorkspacePhase",
        () => env.getWorkspaceStore().getWorkspacePhase(),
      ),
      vscode.commands.registerCommand(
        "agentPlatform.test.getWorkspaceRefreshState",
        () => env.getWorkspaceStore().getWorkspaceRefreshState(),
      ),
      vscode.commands.registerCommand(
        "agentPlatform.test.getWorkspaceProjectMemory",
        () => env.getWorkspaceStore().getWorkspaceProjectMemory(),
      ),
      vscode.commands.registerCommand(
        "agentPlatform.test.getWorkspaceProjectMode",
        () => env.getWorkspaceStore().getWorkspaceProjectMode(),
      ),
      vscode.commands.registerCommand(
        "agentPlatform.test.getWorkspaceSuggestions",
        () => env.getWorkspaceStore().getWorkspaceSuggestions(),
      ),
    );
  }

  context.subscriptions.push(
    pingCommand,
    restartCommand,
    projectSummaryCommand,
    analyzeCurrentSymbolCommand,
    findSymbolCommand,
    searchMemoryCommand,
    reindexWorkspaceCommand,
    discoverProjectActionsCommand,
    runProjectActionCommand,
    runImpactedTestsCommand,
    applySelectedTextToSymbolCommand,
    listCheckpointsCommand,
    restoreCheckpointCommand,
    restoreLastCheckpointCommand,
    showDependenciesCommand,
    showChangeImpactCommand,
    providerStatusCommand,
    agentPreviewCommand,
    agentActionCommand,
    observabilityDashboardCommand,
    lastAgentTraceCommand,
    showStoredAgentRunCommand,
    agentRunHistoryCommand,
    clearAgentRunHistoryCommand,
    saveLastRunToMemoryCommand,
    promoteProjectMemoryCommand,
    ...testCommands,
  );
}
