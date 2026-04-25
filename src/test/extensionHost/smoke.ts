import assert from "node:assert/strict";

import * as vscode from "vscode";

import type { StoredPreviewRun } from "../../state/sessionStore";
import type { TelemetrySnapshot } from "../../state/telemetryState";
import type { ActiveRunRecord, LastCheckpointRecord } from "../../state/workspaceStore";
import { join } from "node:path";
import type { ObservabilityPanelSnapshot, ToolInvocationRecord } from "../../testing/extensionTestHarness";

interface SimulatedToolRoutingResult {
  invoked: boolean;
  approvalRequested: boolean;
  denied: boolean;
  completedTools: string[];
  approvalRequest?: {
    title: string;
    toolName: string;
    summary?: string;
    reason: string;
  };
  result?: {
    name: string;
    ok: boolean;
    content: string[];
    error: string | null;
    active_project: string;
  };
}

const REQUIRED_COMMANDS = [
  "agentPlatform.pingBackend",
  "agentPlatform.restartBackend",
  "agentPlatform.askAgentPreview",
  "agentPlatform.askAgentAction",
  "agentPlatform.showLastAgentTrace",
  "agentPlatform.showAgentRunHistory",
  "agentPlatform.showProviderStatus",
  "agentPlatform.showObservabilityDashboard",
] as const;

function createMockToolResult(
  name: string,
  activeProject: string,
  content: string[],
  ok = true,
): {
  name: string;
  ok: boolean;
  content: string[];
  error: string | null;
  active_project: string;
} {
  return {
    name,
    ok,
    content,
    error: ok ? null : `${name} failed`,
    active_project: activeProject,
  };
}

function createSeededRun(): StoredPreviewRun {
  return {
    id: "smoke-run-1",
    query: "What is this project about?",
    answer: "A Python backend with a VS Code extension orchestrator.",
    createdAt: "2026-04-24T15:00:00.000Z",
    startedAt: "2026-04-24T14:59:59.000Z",
    durationMs: 1000,
    source: "command",
    outcome: "completed",
    activeFilePath: "src/token_savior/service_api/service.py",
    result: {
      query: "What is this project about?",
      mode: "preview",
      plan: {
        kind: "tool",
        toolName: "get_project_summary",
        arguments: {},
        reasoning: "Need the project summary.",
        source: "heuristic",
      },
      answer: "A Python backend with a VS Code extension orchestrator.",
      providerKind: "copilot",
      toolResult: {
        name: "get_project_summary",
        ok: true,
        content: ["Python backend + VS Code extension"],
      },
      trace: [],
    },
  };
}

export async function runSmokeTests(): Promise<void> {
  const extension = vscode.extensions.getExtension("mibayy.token-savior-agent");
  assert.ok(extension, "Expected the Token Savior extension to be discoverable in the extension host.");

  await extension.activate();
  assert.ok(extension.isActive, "Expected the Token Savior extension to activate successfully.");

  const commands = await vscode.commands.getCommands(true);
  for (const command of REQUIRED_COMMANDS) {
    assert.ok(commands.includes(command), `Expected command ${command} to be contributed after activation.`);
  }

  const config = vscode.workspace.getConfiguration("agentPlatform");
  assert.equal(config.get("persistRunHistory"), true);
  assert.equal(config.get("autoSaveProjectMemory"), false);

  await vscode.commands.executeCommand("agentPlatform.test.resetState");

  await vscode.commands.executeCommand("agentPlatform.pingBackend");
  await vscode.commands.executeCommand("agentPlatform.restartBackend");
  await vscode.commands.executeCommand("agentPlatform.showProviderStatus");
  await vscode.commands.executeCommand("agentPlatform.showLastAgentTrace");
  await vscode.commands.executeCommand("agentPlatform.showAgentRunHistory");

  const seededRun = createSeededRun();
  await vscode.commands.executeCommand("agentPlatform.test.seedPreviewRun", seededRun, { recordTelemetry: true });

  const runs = await vscode.commands.executeCommand<StoredPreviewRun[]>("agentPlatform.test.listPreviewRuns");
  assert.ok(runs?.some((run) => run.id === seededRun.id), "Expected the seeded preview run to be present in session state.");

  const telemetry = await vscode.commands.executeCommand<TelemetrySnapshot>("agentPlatform.test.getTelemetrySnapshot");
  assert.equal(telemetry?.totalRuns, 1);
  assert.equal(telemetry?.previewRuns, 1);
  assert.equal(telemetry?.completedRuns, 1);
  assert.equal(telemetry?.providerUsage.copilot, 1);

  await vscode.commands.executeCommand("agentPlatform.showStoredAgentRun", seededRun.id);
  await vscode.commands.executeCommand("agentPlatform.showLastAgentTrace");


  const activeRun: ActiveRunRecord = {
    id: "recovery-run-1",
    query: "Run impacted tests for TokenSaviorService",
    mode: "action",
    source: "command",
    startedAt: "2026-04-24T15:05:00.000Z",
    activeFilePath: "src/token_savior/service_api/service.py",
  };
  await vscode.commands.executeCommand("agentPlatform.test.seedActiveRun", activeRun);
  const recovered = await vscode.commands.executeCommand<boolean>("agentPlatform.test.runRecoveryCheck");
  assert.equal(recovered, true);

  const clearedActiveRun = await vscode.commands.executeCommand<ActiveRunRecord | undefined>("agentPlatform.test.getActiveRun");
  assert.equal(clearedActiveRun, undefined);

  const telemetryAfterRecovery = await vscode.commands.executeCommand<TelemetrySnapshot>("agentPlatform.test.getTelemetrySnapshot");
  assert.equal(telemetryAfterRecovery?.recoveryEvents, 1);
  assert.match(telemetryAfterRecovery?.lastRecoveryMessage ?? "", /recovery-run-1|Run impacted tests/i);

  const deniedEdit = await vscode.commands.executeCommand<SimulatedToolRoutingResult>(
    "agentPlatform.test.simulateToolRouting",
    {
      toolName: "apply_symbol_change_and_validate",
      workspaceTrusted: true,
      approvalDecision: false,
    },
  );
  assert.equal(deniedEdit?.approvalRequested, true);
  assert.equal(deniedEdit?.denied, true);
  assert.equal(deniedEdit?.invoked, false);
  assert.match(deniedEdit?.approvalRequest?.reason ?? "", /edit tools/i);

  const trustedTest = await vscode.commands.executeCommand<SimulatedToolRoutingResult>(
    "agentPlatform.test.simulateToolRouting",
    {
      toolName: "run_impacted_tests",
      workspaceTrusted: true,
    },
  );
  assert.equal(trustedTest?.approvalRequested, false);
  assert.equal(trustedTest?.denied, false);
  assert.equal(trustedTest?.invoked, true);
  assert.deepEqual(trustedTest?.completedTools, ["run_impacted_tests"]);

  const forcedReadApproval = await vscode.commands.executeCommand<SimulatedToolRoutingResult>(
    "agentPlatform.test.simulateToolRouting",
    {
      toolName: "find_symbol",
      forceApproval: true,
      approvalDecision: true,
      workspaceTrusted: true,
    },
  );
  assert.equal(forcedReadApproval?.approvalRequested, true);
  assert.equal(forcedReadApproval?.denied, false);
  assert.equal(forcedReadApproval?.invoked, true);

  const destructiveDenied = await vscode.commands.executeCommand<SimulatedToolRoutingResult>(
    "agentPlatform.test.simulateToolRouting",
    {
      toolName: "restore_checkpoint",
      workspaceTrusted: true,
      approvalDecision: false,
    },
  );
  assert.equal(destructiveDenied?.approvalRequested, true);
  assert.equal(destructiveDenied?.denied, true);
  assert.equal(destructiveDenied?.invoked, false);
  assert.match(destructiveDenied?.approvalRequest?.reason ?? "", /destructive tools/i);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, "Expected the extension-host smoke workspace to be available.");

  const readmePath = join(workspaceRoot, "README.md");
  const document = await vscode.workspace.openTextDocument(readmePath);
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const lastSelectionLine = Math.min(2, Math.max(document.lineCount - 1, 0));
  editor.selection = new vscode.Selection(
    new vscode.Position(0, 0),
    document.lineAt(lastSelectionLine).range.end,
  );

  await vscode.commands.executeCommand("agentPlatform.test.setToolResponses", [
    {
      toolName: "memory_session_history",
      response: createMockToolResult("memory_session_history", workspaceRoot, []),
    },
    {
      toolName: "memory_search",
      response: createMockToolResult("memory_search", workspaceRoot, []),
    },
    {
      toolName: "apply_symbol_change_and_validate",
      response: createMockToolResult(
        "apply_symbol_change_and_validate",
        workspaceRoot,
        [JSON.stringify({ checkpoint_id: "ckpt-live-1", validated: true })],
      ),
    },
  ]);
  await vscode.commands.executeCommand("agentPlatform.test.enqueueInputBoxResponses", [
    "Apply the selected text to TokenSaviorService.invoke_tool and validate",
  ]);
  await vscode.commands.executeCommand("agentPlatform.test.enqueueWarningMessageResponses", ["Approve"]);
  await vscode.commands.executeCommand("agentPlatform.askAgentAction");

  const runsAfterAction = await vscode.commands.executeCommand<StoredPreviewRun[]>("agentPlatform.test.listPreviewRuns");
  const actionRun = runsAfterAction?.find((run) => run.result.mode === "action" && run.id !== seededRun.id);
  assert.ok(actionRun, "Expected an action-mode run recorded from the real askAgentAction command flow.");
  assert.equal(actionRun?.outcome, "completed");
  assert.equal(actionRun?.result.plan.kind, "tool");
  assert.equal(actionRun?.result.plan.kind === "tool" ? actionRun.result.plan.toolName : undefined, "apply_symbol_change_and_validate");

  const actionToolInvocations = await vscode.commands.executeCommand<ToolInvocationRecord[]>(
    "agentPlatform.test.getToolInvocations",
  );
  const applyInvocation = actionToolInvocations?.find((call) => call.toolName === "apply_symbol_change_and_validate");
  assert.ok(applyInvocation, "Expected the action command flow to invoke apply_symbol_change_and_validate through the backend gateway.");
  assert.equal(applyInvocation?.argumentsPayload.symbol_name, "TokenSaviorService.invoke_tool");
  assert.equal(applyInvocation?.argumentsPayload.file_path, "README.md");

  const lastCheckpoint = await vscode.commands.executeCommand<LastCheckpointRecord | undefined>(
    "agentPlatform.test.getLastCheckpoint",
  );
  assert.equal(lastCheckpoint?.checkpointId, "ckpt-live-1");
  assert.equal(lastCheckpoint?.filePath, "README.md");

  const telemetryAfterAction = await vscode.commands.executeCommand<TelemetrySnapshot>("agentPlatform.test.getTelemetrySnapshot");
  assert.equal(telemetryAfterAction?.totalRuns, 2);
  assert.equal(telemetryAfterAction?.actionRuns, 1);
  assert.equal(telemetryAfterAction?.completedRuns, 2);

  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await vscode.commands.executeCommand("agentPlatform.showObservabilityDashboard", actionRun?.id);
  assert.ok(extension.isActive, "Expected the Token Savior extension to remain active after the dashboard command.");

  const observabilityPanel = await vscode.commands.executeCommand<ObservabilityPanelSnapshot | undefined>(
    "agentPlatform.test.getLastObservabilityPanel",
  );
  assert.equal(observabilityPanel?.viewType, "agentPlatform.observability");
  assert.equal(observabilityPanel?.title, "Token Savior Observability");
  assert.match(observabilityPanel?.html ?? "", /Action runs/);
  assert.match(observabilityPanel?.html ?? "", /Apply the selected text to TokenSaviorService\.invoke_tool and validate/);
  assert.match(observabilityPanel?.html ?? "", /ckpt-live-1/);
  assert.match(observabilityPanel?.html ?? "", /Latest checkpoint/);

  await vscode.commands.executeCommand("agentPlatform.test.clearToolResponses");
  await vscode.commands.executeCommand("agentPlatform.test.setToolResponses", [
    {
      toolName: "list_checkpoints",
      response: createMockToolResult(
        "list_checkpoints",
        workspaceRoot,
        [JSON.stringify([{ checkpoint_id: "ckpt-live-1", created_at: "2026-04-24T15:15:00.000Z" }])],
      ),
    },
    {
      toolName: "restore_checkpoint",
      response: createMockToolResult("restore_checkpoint", workspaceRoot, ["Restored checkpoint ckpt-live-1"]),
    },
  ]);
  await vscode.commands.executeCommand("agentPlatform.test.enqueueQuickPickResponses", ["ckpt-live-1"]);
  await vscode.commands.executeCommand("agentPlatform.test.enqueueWarningMessageResponses", ["Approve"]);
  await vscode.commands.executeCommand("agentPlatform.restoreCheckpoint");

  const restoreInvocations = await vscode.commands.executeCommand<ToolInvocationRecord[]>(
    "agentPlatform.test.getToolInvocations",
  );
  assert.ok(restoreInvocations?.some((call) => call.toolName === "list_checkpoints"), "Expected restoreCheckpoint to list checkpoints before restoring.");
  const restoreInvocation = restoreInvocations?.find((call) => call.toolName === "restore_checkpoint");
  assert.ok(restoreInvocation, "Expected restoreCheckpoint to invoke the destructive restore tool after interactive selection and approval.");
  assert.equal(restoreInvocation?.argumentsPayload.checkpoint_id, "ckpt-live-1");
}