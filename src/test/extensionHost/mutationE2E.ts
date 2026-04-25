import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import * as vscode from "vscode";

import { tryParseJsonContent, type ServiceToolResult } from "../../backend/protocol";
import type { StoredPreviewRun } from "../../state/sessionStore";
import type { TelemetrySnapshot } from "../../state/telemetryState";
import type { LastCheckpointRecord } from "../../state/workspaceStore";
import type { ObservabilityPanelSnapshot, ToolInvocationRecord } from "../../testing/extensionTestHarness";

const EXTENSION_ID = "mibayy.token-savior-agent";

async function readWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string> {
  return readFile(join(workspaceRoot, relativePath), "utf-8");
}

async function writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string): Promise<void> {
  await writeFile(join(workspaceRoot, relativePath), content, "utf-8");
}

async function openWorkspaceDocument(workspaceRoot: string, relativePath: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(join(workspaceRoot, relativePath));
  return vscode.window.showTextDocument(document, { preview: false });
}

function findLineIndex(document: vscode.TextDocument, expected: string, start = 0): number {
  for (let index = start; index < document.lineCount; index += 1) {
    if (document.lineAt(index).text.trim() === expected) {
      return index;
    }
  }

  return -1;
}

async function selectReplacementBlock(editor: vscode.TextEditor, blockName: string): Promise<void> {
  const document = editor.document;
  const opener = `${blockName} = \"\"\"`;
  const openerLine = findLineIndex(document, opener);
  assert.ok(openerLine >= 0, `Expected to find replacement block ${blockName}.`);
  const closerLine = findLineIndex(document, '"""', openerLine + 1);
  assert.ok(closerLine > openerLine + 1, `Expected a closing triple quote for ${blockName}.`);

  editor.selection = new vscode.Selection(
    new vscode.Position(openerLine + 1, 0),
    document.lineAt(closerLine - 1).range.end,
  );
}

async function enqueueApproval(): Promise<void> {
  await vscode.commands.executeCommand("agentPlatform.test.enqueueWarningMessageResponses", ["Approve"]);
}

async function runActionCommand(query: string): Promise<void> {
  await vscode.commands.executeCommand("agentPlatform.test.enqueueInputBoxResponses", [query]);
  await enqueueApproval();
  await vscode.commands.executeCommand("agentPlatform.askAgentAction");
}

function getLatestActionRun(runs: StoredPreviewRun[], query: string): StoredPreviewRun | undefined {
  return runs.find((run) => run.query === query && run.result.mode === "action");
}

function getLatestToolResult(run: StoredPreviewRun | undefined): ServiceToolResult | undefined {
  if (!run) {
    return undefined;
  }

  if (run.result.toolResults && run.result.toolResults.length > 0) {
    return run.result.toolResults[run.result.toolResults.length - 1];
  }

  return run.result.toolResult;
}

async function overwriteGreeting(workspaceRoot: string): Promise<void> {
  const relativePath = "src/demo_module.py";
  const original = await readWorkspaceFile(workspaceRoot, relativePath);
  const updated = original.replace('return f"Hi there, {name}!"', 'return f"Manual drift, {name}!"');
  assert.notEqual(updated, original, "Expected to inject a manual drift into the greeting function.");
  await writeWorkspaceFile(workspaceRoot, relativePath, updated);
}

export async function runMutationE2ETests(): Promise<void> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, "Expected the Token Savior extension to be discoverable in the extension host.");

  await extension.activate();
  assert.ok(extension.isActive, "Expected the Token Savior extension to activate successfully.");

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(workspaceRoot, "Expected the disposable mutation workspace to be available.");

  await vscode.commands.executeCommand("agentPlatform.test.resetState");

  const editor = await openWorkspaceDocument(workspaceRoot, "src/demo_module.py");
  await selectReplacementBlock(editor, "SUCCESS_REPLACEMENT");
  await runActionCommand("Apply the selected text to greet and validate");

  const successContent = await readWorkspaceFile(workspaceRoot, "src/demo_module.py");
  assert.match(successContent, /return f\"Hi there, \{name\}!\"/);

  const runsAfterSuccess = await vscode.commands.executeCommand<StoredPreviewRun[]>("agentPlatform.test.listPreviewRuns");
  const successRun = getLatestActionRun(runsAfterSuccess ?? [], "Apply the selected text to greet and validate");
  assert.ok(successRun, "Expected a successful mutation action run to be recorded.");
  assert.equal(successRun?.outcome, "completed");

  const successPayload = tryParseJsonContent<Record<string, unknown>>(getLatestToolResult(successRun)!);
  assert.equal(successPayload?.ok, true);
  assert.equal((successPayload?.validation as { ok?: unknown } | undefined)?.ok, true);
  assert.match(JSON.stringify((successPayload?.validation as { selection?: unknown } | undefined)?.selection ?? {}), /test_demo_module\.py/i);

  const firstCheckpoint = await vscode.commands.executeCommand<LastCheckpointRecord | undefined>("agentPlatform.test.getLastCheckpoint");
  assert.ok(firstCheckpoint?.checkpointId, "Expected the successful mutation to persist a checkpoint id.");
  assert.equal(firstCheckpoint?.filePath?.replace(/\\/g, "/"), "src/demo_module.py");

  const telemetryAfterSuccess = await vscode.commands.executeCommand<TelemetrySnapshot>("agentPlatform.test.getTelemetrySnapshot");
  assert.equal(telemetryAfterSuccess?.totalRuns, 1);
  assert.equal(telemetryAfterSuccess?.actionRuns, 1);
  assert.equal(telemetryAfterSuccess?.completedRuns, 1);
  assert.equal(telemetryAfterSuccess?.failedRuns, 0);

  const contentBeforeFailure = successContent;
  const refreshedEditor = await openWorkspaceDocument(workspaceRoot, "src/demo_module.py");
  await selectReplacementBlock(refreshedEditor, "FAILURE_REPLACEMENT");
  await runActionCommand("Apply the selected text to greet and validate again");

  const contentAfterFailure = await readWorkspaceFile(workspaceRoot, "src/demo_module.py");
  assert.equal(contentAfterFailure, contentBeforeFailure, "Expected the failed mutation to be rolled back to the previous checkpoint state.");

  const runsAfterFailure = await vscode.commands.executeCommand<StoredPreviewRun[]>("agentPlatform.test.listPreviewRuns");
  const failedRun = getLatestActionRun(runsAfterFailure ?? [], "Apply the selected text to greet and validate again");
  assert.ok(failedRun, "Expected a failed mutation action run to be recorded.");
  assert.equal(failedRun?.outcome, "failed");

  const failedPayload = tryParseJsonContent<Record<string, unknown>>(getLatestToolResult(failedRun)!);
  assert.equal(failedPayload?.ok, false);
  assert.equal((failedPayload?.rollback as { ok?: unknown } | undefined)?.ok, true);

  const telemetryAfterFailure = await vscode.commands.executeCommand<TelemetrySnapshot>("agentPlatform.test.getTelemetrySnapshot");
  assert.equal(telemetryAfterFailure?.totalRuns, 2);
  assert.equal(telemetryAfterFailure?.completedRuns, 1);
  assert.equal(telemetryAfterFailure?.failedRuns, 1);
  assert.match(telemetryAfterFailure?.lastFailureMessage ?? "", /validation failed|apply_symbol_change_and_validate/i);

  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await vscode.commands.executeCommand("agentPlatform.showObservabilityDashboard", failedRun?.id);
  const observabilityPanel = await vscode.commands.executeCommand<ObservabilityPanelSnapshot | undefined>("agentPlatform.test.getLastObservabilityPanel");
  assert.match(observabilityPanel?.html ?? "", /Latest checkpoint/);
  assert.match(observabilityPanel?.html ?? "", /Last failure:/);

  const checkpointBeforeRestore = await vscode.commands.executeCommand<LastCheckpointRecord | undefined>("agentPlatform.test.getLastCheckpoint");
  assert.ok(checkpointBeforeRestore?.checkpointId, "Expected the rollback attempt to keep a restorable checkpoint id.");
  const checkpointState = await readWorkspaceFile(workspaceRoot, "src/demo_module.py");

  await overwriteGreeting(workspaceRoot);
  const driftedContent = await readWorkspaceFile(workspaceRoot, "src/demo_module.py");
  assert.notEqual(driftedContent, checkpointState, "Expected the manual drift to diverge from the checkpoint state.");

  await enqueueApproval();
  await vscode.commands.executeCommand("agentPlatform.restoreLastCheckpoint");

  const restoredContent = await readWorkspaceFile(workspaceRoot, "src/demo_module.py");
  assert.equal(restoredContent, checkpointState, "Expected restoreCheckpoint to return the file to the selected checkpoint state.");

  const toolInvocations = await vscode.commands.executeCommand<ToolInvocationRecord[]>("agentPlatform.test.getToolInvocations");
  const restoreInvocation = toolInvocations?.find((call) => call.toolName === "restore_checkpoint");
  assert.ok(restoreInvocation, "Expected restoreCheckpoint to invoke the destructive restore tool.");
  assert.equal(restoreInvocation?.argumentsPayload.checkpoint_id, checkpointBeforeRestore.checkpointId);
}

export async function run(): Promise<void> {
  await runMutationE2ETests();
}
