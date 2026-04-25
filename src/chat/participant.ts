import * as vscode from "vscode";

import { recordPreviewRun } from "../agent/runRecorder";
import {
  AgentRuntime,
  AgentRuntimeCancelledError,
  deriveRunFailureMessage,
  deriveRunOutcome,
} from "../agent/runtime";
import type { ToolProviderRegistry } from "../tools/providerRegistry";
import type { MemoryCapability } from "../tools/interface";
import type { ApprovalSettings } from "../policies/approvalPolicy";
import { ModelProviderRegistry } from "../providers/registry";
import { SessionStore } from "../state/sessionStore";
import { type TelemetryState } from "../state/telemetryState";
import { type WorkspaceStore } from "../state/workspaceStore";
import { BackendStatusBarController } from "../ui/statusBar";

import {
  formatChatParticipantResult,
  resolveChatParticipantPrompt,
} from "./presentation";

export interface ChatParticipantEnvironment {
  toolProviderRegistry: ToolProviderRegistry;
  /** Optional direct gateway reference — used only for health reads from the token-savior adapter. */
  gateway?: import("../adapters/tokenSavior/gateway").BackendGateway;
  /** Memory capability resolved from the active tool provider — passed to AgentRuntime. */
  memoryCapability?: MemoryCapability;
  statusBar: BackendStatusBarController;
  outputChannel: vscode.OutputChannel;
  getWorkspaceRoot(): string | undefined;
  getProviderRegistry(): ModelProviderRegistry;
  getSessionStore(): SessionStore;
  getApprovalSettings(): ApprovalSettings;
  getWorkspaceStore(): WorkspaceStore;
  getTelemetryState(): TelemetryState;
}

function getSelectedText(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return undefined;
  }

  const text = editor.document.getText(editor.selection).trim();
  return text.length > 0 ? text : undefined;
}

function getActiveFilePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath;
}

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  env: ChatParticipantEnvironment,
): vscode.ChatParticipant {
  const handler: vscode.ChatRequestHandler = async (request, _chatContext, stream, token) => {
    const workspaceRoot = env.getWorkspaceRoot();
    if (!workspaceRoot) {
      stream.markdown("Open a workspace folder before using Token Savior chat.");
      env.statusBar.setIdle("Open a workspace folder to use Token Savior chat.");
      return;
    }

    const selectedText = getSelectedText();
    const resolvedPrompt = resolveChatParticipantPrompt(request.prompt, request.command, selectedText);
    if (!resolvedPrompt.trim()) {
      stream.markdown("Ask for a project summary, symbol analysis, dependencies, change impact, or memory lookup.");
      return;
    }

    env.statusBar.setStarting("Running Token Savior chat…");
    const runId = `chat-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    await env.getWorkspaceStore().saveActiveRun({
      id: runId,
      query: resolvedPrompt,
      mode: "preview",
      source: "chat",
      startedAt,
      activeFilePath: getActiveFilePath(),
    });
    try {
      const runtime = new AgentRuntime({
        workspaceRoot,
        providerRegistry: env.getProviderRegistry(),
        sessionStore: env.getSessionStore(),
        listTools: () => env.toolProviderRegistry.listAllTools(),
        memoryCapability: env.memoryCapability,
        toolExecutor: {
          invokeTool: (root, name, argumentsPayload) => env.toolProviderRegistry.routeTool(name, argumentsPayload, root),
        },
      });
      const result = await runtime.runPreview({
        query: resolvedPrompt,
        selectedText,
        activeFilePath: getActiveFilePath(),
        cancellationSignal: token,
      });
      const outcome = deriveRunOutcome(result);

      const recorded = await recordPreviewRun({
        toolProviderRegistry: env.toolProviderRegistry,
        sessionStore: env.getSessionStore(),
        workspaceRoot,
        getApprovalSettings: env.getApprovalSettings,
      }, {
        id: runId,
        query: result.query,
        result,
        source: "chat",
        activeFilePath: getActiveFilePath(),
        startedAt,
        durationMs: Date.now() - startedMs,
        outcome,
      });
      await env.getTelemetryState().recordRun(recorded.run);
      await env.getWorkspaceStore().clearActiveRun();

      stream.markdown(formatChatParticipantResult(result));
      if (recorded.memoryStatus.state === "saved") {
        stream.markdown(`_Saved this run to project memory automatically._`);
      } else if (recorded.memoryStatus.state === "failed") {
        env.outputChannel.appendLine(`Token Savior auto-save warning: ${recorded.memoryStatus.reason}`);
      }
      stream.button({
        command: "agentPlatform.showStoredAgentRun",
        title: "Open run details",
        arguments: [recorded.run.id],
      });
      stream.button({
        command: "agentPlatform.showLastAgentTrace",
        title: "Show trace",
      });
      if (outcome === "failed") {
        const failureMessage = deriveRunFailureMessage(recorded.run.result) ?? "Token Savior chat returned a failed backend tool result.";
        stream.markdown(`\n\n_Failed tool result: ${failureMessage}_`);
        env.statusBar.setError(failureMessage);
        return;
      }

      env.statusBar.setReady(env.gateway?.getLastHealth(), "Token Savior chat complete.");
    } catch (error) {
      if (error instanceof AgentRuntimeCancelledError) {
        await env.getTelemetryState().recordRunEvent({
          mode: "preview",
          source: "chat",
          outcome: "cancelled",
          durationMs: Date.now() - startedMs,
          toolCallCount: 0,
          finishedAt: new Date().toISOString(),
        });
        await env.getWorkspaceStore().clearActiveRun();
        stream.markdown("Token Savior chat request was cancelled.");
        env.statusBar.setIdle("Chat request cancelled.");
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      await env.getTelemetryState().recordRunEvent({
        mode: "preview",
        source: "chat",
        outcome: "failed",
        durationMs: Date.now() - startedMs,
        toolCallCount: 0,
        finishedAt: new Date().toISOString(),
        errorMessage: message,
      });
      await env.getWorkspaceStore().clearActiveRun();
      stream.markdown(`Token Savior failed: ${message}`);
      env.statusBar.setError(message);
    }
  };

  const participant = vscode.chat.createChatParticipant("agentPlatform.assistant", handler);
  participant.iconPath = new vscode.ThemeIcon("hubot");
  return participant;
}
