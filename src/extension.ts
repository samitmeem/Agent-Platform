import * as vscode from "vscode";

import { ToolApprovalDeniedError, ToolRouter, type ToolApprovalRequest } from "./agent/toolRouter";
import { BackendGateway } from "./backend/gateway";
import { type ServiceHealth, type ServiceToolResult } from "./backend/protocol";
import {
  getPrimaryWorkspaceRoot,
  isTokenSaviorConfigurationChange,
  loadApprovalSettings,
  loadBackendLaunchConfig,
  loadModelProviderSettings,
} from "./config";
import type { ApprovalSettings } from "./policies/approvalPolicy";
import { CopilotModelProvider } from "./providers/copilotProvider";
import { LocalModelProvider } from "./providers/localProvider";
import { ModelProviderRegistry } from "./providers/registry";
import { SessionStore, type StoredPreviewRun } from "./state/sessionStore";
import { TelemetryState } from "./state/telemetryState";
import { WorkspaceStore, type ActiveRunRecord } from "./state/workspaceStore";
import { defaultCommandUi, ExtensionTestHarness } from "./testing/extensionTestHarness";
import { AgentRunHistoryTreeProvider } from "./views/runHistoryTree";
import { registerChatParticipant } from "./chat/participant";
import { registerCommands } from "./commands";
import { BackendStatusBarController } from "./ui/statusBar";

let gateway: BackendGateway | undefined;
let providerRegistry: ModelProviderRegistry | undefined;

async function recoverInterruptedRun(
  workspaceStore: WorkspaceStore,
  telemetryState: TelemetryState,
  outputChannel: vscode.OutputChannel,
): Promise<boolean> {
  const interruptedRun = workspaceStore.getActiveRun();
  if (!interruptedRun) {
    return false;
  }

  const recoveryMessage = `Recovered interrupted ${interruptedRun.mode} run started at ${interruptedRun.startedAt}: ${interruptedRun.query}`;
  outputChannel.appendLine(`[observability] ${recoveryMessage}`);
  await telemetryState.recordRecoveryEvent(recoveryMessage);
  await workspaceStore.clearActiveRun();
  void vscode.window.showWarningMessage(recoveryMessage);
  return true;
}

function registerTestCommands(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore,
  workspaceStore: WorkspaceStore,
  telemetryState: TelemetryState,
  outputChannel: vscode.OutputChannel,
  testHarness?: ExtensionTestHarness,
): void {
  if (context.extensionMode !== vscode.ExtensionMode.Test) {
    return;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.resetState",
      async () => {
        sessionStore.clear();
        await workspaceStore.persistPreviewRuns([]);
        await workspaceStore.clearLastCheckpoint();
        await workspaceStore.clearActiveRun();
        await telemetryState.reset();
        testHarness?.reset();
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.enqueueInputBoxResponses",
      (responses: string[]) => {
        testHarness?.enqueueInputBoxResponses(responses);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.enqueueQuickPickResponses",
      (responses: string[]) => {
        testHarness?.enqueueQuickPickResponses(responses);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.enqueueWarningMessageResponses",
      (responses: string[]) => {
        testHarness?.enqueueWarningMessageResponses(responses);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.setToolResponses",
      (entries: Array<{ toolName: string; response: ServiceToolResult | ServiceToolResult[] }>) => {
        for (const entry of entries) {
          testHarness?.setToolResponses(entry.toolName, entry.response);
        }
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.clearToolResponses",
      (toolName?: string) => {
        testHarness?.clearToolResponses(toolName);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.getToolInvocations",
      () => testHarness?.getToolInvocations() ?? [],
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.getLastObservabilityPanel",
      () => testHarness?.getLastObservabilityPanel(),
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.seedPreviewRun",
      async (run: StoredPreviewRun, options?: { recordTelemetry?: boolean }) => {
        sessionStore.savePreviewRun(run);
        await workspaceStore.persistPreviewRuns(sessionStore.listPreviewRuns(20));
        if (options?.recordTelemetry !== false) {
          await telemetryState.recordRun(run);
        }
        return run.id;
      },
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.listPreviewRuns",
      () => sessionStore.listPreviewRuns(),
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.seedActiveRun",
      async (record: ActiveRunRecord) => {
        await workspaceStore.saveActiveRun(record);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.getActiveRun",
      () => workspaceStore.getActiveRun(),
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.getTelemetrySnapshot",
      () => telemetryState.getSnapshot(),
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.runRecoveryCheck",
      async () => recoverInterruptedRun(workspaceStore, telemetryState, outputChannel),
    ),
    vscode.commands.registerCommand(
      "tokenSaviorAgent.test.simulateToolRouting",
      async (input: {
        toolName: string;
        argumentsPayload?: Record<string, unknown>;
        forceApproval?: boolean;
        approvalDecision?: boolean;
        workspaceTrusted?: boolean;
        approvalSettings?: Partial<ApprovalSettings>;
        result?: Partial<ServiceToolResult>;
      }) => {
        let approvalRequested = false;
        let approvalRequest: ToolApprovalRequest | undefined;
        let invoked = false;
        const completedTools: string[] = [];
        const settings: ApprovalSettings = {
          ...loadApprovalSettings(),
          ...(input.approvalSettings ?? {}),
        };
        const router = new ToolRouter({
          gateway: {
            invokeTool: async (_workspaceRoot: string, toolName: string): Promise<ServiceToolResult> => {
              invoked = true;
              return {
                name: toolName,
                ok: input.result?.ok ?? true,
                content: input.result?.content ?? ["ok"],
                error: input.result?.error ?? null,
                active_project: input.result?.active_project ?? (getPrimaryWorkspaceRoot() ?? "test-workspace"),
              };
            },
          } as never,
          workspaceRoot: getPrimaryWorkspaceRoot() ?? "test-workspace",
          getApprovalSettings: () => settings,
          isWorkspaceTrusted: () => input.workspaceTrusted ?? vscode.workspace.isTrusted,
          requestApproval: async (request) => {
            approvalRequested = true;
            approvalRequest = request;
            return input.approvalDecision ?? false;
          },
          onToolCompleted: async (toolName) => {
            completedTools.push(toolName);
          },
        });

        try {
          const result = await router.invokeTool({
            toolName: input.toolName,
            argumentsPayload: input.argumentsPayload,
            forceApproval: input.forceApproval,
          });
          return {
            invoked,
            approvalRequested,
            approvalRequest,
            denied: false,
            completedTools,
            result,
          };
        } catch (error) {
          if (error instanceof ToolApprovalDeniedError) {
            return {
              invoked,
              approvalRequested,
              approvalRequest,
              denied: true,
              completedTools,
            };
          }

          throw error;
        }
      },
    ),
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel("Token Savior");
  const statusBar = new BackendStatusBarController();
  const sessionStore = new SessionStore();
  const workspaceStore = new WorkspaceStore(context.workspaceState);
  const telemetryState = new TelemetryState(context.workspaceState);
  workspaceStore.hydrateSessionStore(sessionStore);
  const runHistoryTreeProvider = new AgentRunHistoryTreeProvider(sessionStore);
  gateway = new BackendGateway(loadBackendLaunchConfig);
  const testHarness = context.extensionMode === vscode.ExtensionMode.Test ? new ExtensionTestHarness() : undefined;
  if (testHarness) {
    const invokeTool = gateway.invokeTool.bind(gateway);
    gateway.invokeTool = (workspaceRoot: string, name: string, argumentsPayload: Record<string, unknown> = {}) => testHarness.invokeTool(
      invokeTool,
      workspaceRoot,
      name,
      argumentsPayload,
    );
  }
  const createProviderRegistry = (): ModelProviderRegistry => {
    const settings = loadModelProviderSettings();
    return new ModelProviderRegistry(
      [
        new CopilotModelProvider(context, {
          family: settings.copilotModelFamily,
          id: settings.copilotModelId,
        }),
        new LocalModelProvider(settings.localModelLabel, {
          endpoint: settings.localEndpoint,
          modelName: settings.localModelName,
          apiFormat: settings.localApiFormat,
          apiKey: settings.localApiKey,
        }),
      ],
      settings.preferredProvider,
    );
  };
  providerRegistry = createProviderRegistry();
  registerTestCommands(context, sessionStore, workspaceStore, telemetryState, outputChannel, testHarness);

  async function refreshStatus(reason = "refresh"): Promise<ServiceHealth | undefined> {
    const workspaceRoot = getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      statusBar.setIdle("Open a workspace folder to connect.");
      return undefined;
    }

    statusBar.setStarting(`Checking backend (${reason})…`);
    try {
      const health = await gateway!.ping(workspaceRoot);
      statusBar.setReady(health, `Workspace: ${workspaceRoot}`);
      return health;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      statusBar.setError(message);
      return undefined;
    }
  }

  registerCommands(context, {
    gateway,
    statusBar,
    outputChannel,
    ui: testHarness ?? defaultCommandUi,
    getWorkspaceRoot: getPrimaryWorkspaceRoot,
    getProviderRegistry: () => providerRegistry!,
    getSessionStore: () => sessionStore,
    getTelemetryState: () => telemetryState,
    getWorkspaceStore: () => workspaceStore,
    getApprovalSettings: loadApprovalSettings,
    refreshStatus,
    recordObservabilityPanel: (snapshot) => testHarness?.recordObservabilityPanel(snapshot),
  });

  const chatParticipant = registerChatParticipant(context, {
    gateway,
    statusBar,
    outputChannel,
    getWorkspaceRoot: getPrimaryWorkspaceRoot,
    getProviderRegistry: () => providerRegistry!,
    getSessionStore: () => sessionStore,
    getApprovalSettings: loadApprovalSettings,
    getWorkspaceStore: () => workspaceStore,
    getTelemetryState: () => telemetryState,
  });

  await recoverInterruptedRun(workspaceStore, telemetryState, outputChannel);

  context.subscriptions.push(
    outputChannel,
    statusBar,
    runHistoryTreeProvider,
    chatParticipant,
    {
      dispose: sessionStore.subscribe(() => {
        const settings = loadApprovalSettings();
        if (!settings.persistRunHistory) {
          void workspaceStore.persistPreviewRuns([]);
          return;
        }

        void workspaceStore.persistPreviewRuns(sessionStore.listPreviewRuns(20));
      }),
    },
    vscode.window.registerTreeDataProvider("tokenSaviorAgent.runHistory", runHistoryTreeProvider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!isTokenSaviorConfigurationChange(event)) {
        return;
      }

      void (async () => {
        statusBar.setStarting("Applying updated Token Savior configuration…");
        providerRegistry = createProviderRegistry();
        await gateway?.restart();
        await telemetryState.recordBackendRestart();
        await refreshStatus("config changed");
      })();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshStatus("workspace changed");
    }),
    {
      dispose: () => {
        void gateway?.stop();
        gateway = undefined;
        providerRegistry = undefined;
      },
    },
  );

  void refreshStatus("activate");
}

export async function deactivate(): Promise<void> {
  await gateway?.stop();
  gateway = undefined;
  providerRegistry = undefined;
}