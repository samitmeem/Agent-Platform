import * as vscode from "vscode";

import { ToolApprovalDeniedError, ToolRouter, type ToolApprovalRequest } from "./agent/toolRouter";
import { BackendGateway } from "./adapters/tokenSavior/gateway";
import { TokenSaviorToolProvider } from "./adapters/tokenSavior/adapter";
import { type ServiceHealth } from "./adapters/tokenSavior/protocol";
import type { ToolResult } from "./tools/interface";
import { ToolProviderRegistry } from "./tools/providerRegistry";
import { ToolPolicyRegistry, globalToolPolicyRegistry } from "./policies/toolPolicy";
import {
  getPrimaryWorkspaceRoot,
  isTokenSaviorConfigurationChange,
  loadApprovalSettings,
  loadAutomationSettings,
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
import { registerCopilotTools } from "./copilotTools";
import { WorkspaceRefreshCoordinator } from "./agent/refreshCoordinator";
import {
  shouldRefreshProjectMemoryForPath,
} from "./agent/projectMemoryInitializer";
import { DEFAULT_WORKSPACE_REFRESH_STATE } from "./state/workspaceAnalysis";
import { BackendStatusBarController } from "./ui/statusBar";

let tokenSaviorProvider: TokenSaviorToolProvider | undefined;
let toolProviderRegistry: ToolProviderRegistry | undefined;
let gateway: BackendGateway | undefined;
let providerRegistry: ModelProviderRegistry | undefined;

const WORKSPACE_BOOTSTRAP_TIMEOUT_MS = 4_000;

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
      "agentPlatform.test.resetState",
      async () => {
        sessionStore.clear();
        await workspaceStore.persistPreviewRuns([]);
        await workspaceStore.clearLastCheckpoint();
        await workspaceStore.clearActiveRun();
        await workspaceStore.clearWorkspaceProfile();
        await workspaceStore.clearWorkspacePhase();
        await workspaceStore.clearWorkspaceProjectMode();
        await workspaceStore.clearWorkspaceProjectMemory();
        await workspaceStore.clearWorkspaceSuggestions();
        await workspaceStore.saveWorkspaceRefreshState({ ...DEFAULT_WORKSPACE_REFRESH_STATE });
        await telemetryState.reset();
        testHarness?.reset();
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.enqueueInputBoxResponses",
      (responses: string[]) => {
        testHarness?.enqueueInputBoxResponses(responses);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.enqueueQuickPickResponses",
      (responses: string[]) => {
        testHarness?.enqueueQuickPickResponses(responses);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.enqueueWarningMessageResponses",
      (responses: string[]) => {
        testHarness?.enqueueWarningMessageResponses(responses);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.setToolResponses",
      (entries: Array<{ toolName: string; response: ToolResult | ToolResult[] }>) => {
        for (const entry of entries) {
          testHarness?.setToolResponses(entry.toolName, entry.response);
        }
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.clearToolResponses",
      (toolName?: string) => {
        testHarness?.clearToolResponses(toolName);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.getToolInvocations",
      () => testHarness?.getToolInvocations() ?? [],
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.getLastObservabilityPanel",
      () => testHarness?.getLastObservabilityPanel(),
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.seedPreviewRun",
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
      "agentPlatform.test.listPreviewRuns",
      () => sessionStore.listPreviewRuns(),
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.seedActiveRun",
      async (record: ActiveRunRecord) => {
        await workspaceStore.saveActiveRun(record);
        return true;
      },
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.getActiveRun",
      () => workspaceStore.getActiveRun(),
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.getTelemetrySnapshot",
      () => telemetryState.getSnapshot(),
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.runRecoveryCheck",
      async () => recoverInterruptedRun(workspaceStore, telemetryState, outputChannel),
    ),
    vscode.commands.registerCommand(
      "agentPlatform.test.simulateToolRouting",
      async (input: {
        toolName: string;
        argumentsPayload?: Record<string, unknown>;
        forceApproval?: boolean;
        approvalDecision?: boolean;
        workspaceTrusted?: boolean;
        approvalSettings?: Partial<ApprovalSettings>;
        result?: Partial<ToolResult>;
      }) => {
        let approvalRequested = false;
        let approvalRequest: ToolApprovalRequest | undefined;
        let invoked = false;
        const completedTools: string[] = [];
        const settings: ApprovalSettings = {
          ...loadApprovalSettings(),
          ...(input.approvalSettings ?? {}),
        };
        const mockRegistry = {
          routeTool: async (_name: string, _args: Record<string, unknown>, _root: string): Promise<ToolResult> => {
            invoked = true;
            return {
              name: _name,
              ok: input.result?.ok ?? true,
              content: input.result?.content ?? ["ok"],
              error: input.result?.error ?? null,
            };
          },
        } as unknown as ToolProviderRegistry;
        const router = new ToolRouter({
          toolProviderRegistry: mockRegistry,
          policyRegistry: globalToolPolicyRegistry,
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
  const outputChannel = vscode.window.createOutputChannel("Agent-Platform");
  const statusBar = new BackendStatusBarController();
  const sessionStore = new SessionStore();
  const workspaceStore = new WorkspaceStore(context.workspaceState);
  const telemetryState = new TelemetryState(context.workspaceState);
  const getAutomationSettings = () => loadAutomationSettings();
  workspaceStore.hydrateSessionStore(sessionStore);
  const runHistoryTreeProvider = new AgentRunHistoryTreeProvider(sessionStore);

  // Build the platform registries
  const policyRegistry = globalToolPolicyRegistry;
  toolProviderRegistry = new ToolProviderRegistry();

  // Register the token-savior adapter — conditional on the backend.enabled setting
  const isBackendEnabled = vscode.workspace.getConfiguration("agentPlatform").get<boolean>("backend.enabled") ?? true;
  if (isBackendEnabled) {
    tokenSaviorProvider = new TokenSaviorToolProvider(
      (workspaceRoot) => {
        const config = vscode.workspace.getConfiguration("agentPlatform");
        return {
          workspaceRoot,
          configuredPythonPath: config.get<string>("pythonPath") ?? undefined,
          serviceModule: config.get<string>("serviceModule") ?? undefined,
        };
      },
      policyRegistry,
    );
    toolProviderRegistry.registerProvider(tokenSaviorProvider);
    gateway = tokenSaviorProvider.getGateway();
    gateway.setToolTimeoutMs(getAutomationSettings().toolTimeoutMs);
  }

  const testHarness = context.extensionMode === vscode.ExtensionMode.Test ? new ExtensionTestHarness() : undefined;
  let effectiveRegistry = toolProviderRegistry;
  if (testHarness) {
    // Wrap the registry so the test harness can intercept tool calls
    const originalRoute = toolProviderRegistry.routeTool.bind(toolProviderRegistry);
    effectiveRegistry = Object.create(toolProviderRegistry) as ToolProviderRegistry;
    effectiveRegistry.routeTool = (name, args, root) => testHarness.invokeTool(
      (_root, _name, _args) => originalRoute(_name, _args ?? {}, _root),
      root,
      name,
      args,
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
  await telemetryState.recordAutomationProfile(getAutomationSettings().profile);
  registerTestCommands(context, sessionStore, workspaceStore, telemetryState, outputChannel, testHarness);
  const refreshCoordinator = new WorkspaceRefreshCoordinator({
    getWorkspaceRoot: getPrimaryWorkspaceRoot,
    sessionStore,
    workspaceStore,
    outputChannel,
    bootstrapTimeoutMs: WORKSPACE_BOOTSTRAP_TIMEOUT_MS,
    resolveAutomationSettings: getAutomationSettings,
    onRefreshTelemetry: async (event) => {
      await telemetryState.recordWorkspaceRefresh(event);
    },
  });

  async function refreshStatus(reason = "refresh"): Promise<ServiceHealth | undefined> {
    const workspaceRoot = getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      statusBar.setIdle("Open a workspace folder to connect.");
      return undefined;
    }
    if (!gateway) {
      statusBar.setIdle("No backend configured.");
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
    toolProviderRegistry: effectiveRegistry,
    policyRegistry,
    gateway,
    resolveMemoryCapability: () => toolProviderRegistry!.resolveMemoryCapability(),
    statusBar,
    outputChannel,
    ui: testHarness ?? defaultCommandUi,
    getWorkspaceRoot: getPrimaryWorkspaceRoot,
    getProviderRegistry: () => providerRegistry!,
    getSessionStore: () => sessionStore,
    getTelemetryState: () => telemetryState,
    getWorkspaceStore: () => workspaceStore,
    getApprovalSettings: loadApprovalSettings,
    resolveAutomationSettings: getAutomationSettings,
    refreshStatus,
    refreshProjectContext: (reason) => refreshCoordinator.refreshNow(reason ?? "command"),
    recordObservabilityPanel: (snapshot) => testHarness?.recordObservabilityPanel(snapshot),
  });

  const chatParticipant = registerChatParticipant(context, {
    toolProviderRegistry: effectiveRegistry,
    gateway,
    resolveMemoryCapability: () => toolProviderRegistry!.resolveMemoryCapability(),
    statusBar,
    outputChannel,
    getWorkspaceRoot: getPrimaryWorkspaceRoot,
    getProviderRegistry: () => providerRegistry!,
    getSessionStore: () => sessionStore,
    getApprovalSettings: loadApprovalSettings,
    getWorkspaceStore: () => workspaceStore,
    getTelemetryState: () => telemetryState,
    resolveAutomationSettings: getAutomationSettings,
  });

  await recoverInterruptedRun(workspaceStore, telemetryState, outputChannel);

  // Expose read-only tools to Copilot's native agent mode so they are available
  // without the @agent-platform prefix. Approval-gated tools are intentionally excluded.
  registerCopilotTools(context, {
    toolProviderRegistry: effectiveRegistry,
    getWorkspaceRoot: getPrimaryWorkspaceRoot,
    getSessionStore: () => sessionStore,
    getWorkspaceStore: () => workspaceStore,
  });

  context.subscriptions.push(
    outputChannel,
    statusBar,
    refreshCoordinator,
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
    vscode.window.registerTreeDataProvider("agentPlatform.runHistory", runHistoryTreeProvider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("agentPlatform")) {
        return;
      }

      void (async () => {
        const automationSettings = getAutomationSettings();
        gateway?.setToolTimeoutMs(automationSettings.toolTimeoutMs);
        await telemetryState.recordAutomationProfile(automationSettings.profile);

        if (isTokenSaviorConfigurationChange(event)) {
          statusBar.setStarting("Applying updated Agent-Platform configuration…");
          providerRegistry = createProviderRegistry();
          await gateway?.restart();
          await telemetryState.recordBackendRestart();
          await refreshStatus("config changed");
        }

        await refreshCoordinator.refreshNow("config changed");
      })();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const workspaceRoot = getPrimaryWorkspaceRoot();
      if (!workspaceRoot || document.uri.scheme !== "file" || !getAutomationSettings().enableFileWatchRefresh) {
        return;
      }
      if (!shouldRefreshProjectMemoryForPath(workspaceRoot, document.uri.fsPath)) {
        return;
      }

      refreshCoordinator.scheduleRefresh("document saved");
    }),
    vscode.workspace.onDidCreateFiles((event) => {
      const workspaceRoot = getPrimaryWorkspaceRoot();
      if (!workspaceRoot || !getAutomationSettings().enableFileWatchRefresh) {
        return;
      }
      if (!event.files.some((uri) => uri.scheme === "file" && shouldRefreshProjectMemoryForPath(workspaceRoot, uri.fsPath))) {
        return;
      }

      refreshCoordinator.scheduleRefresh("files created");
    }),
    vscode.workspace.onDidDeleteFiles((event) => {
      const workspaceRoot = getPrimaryWorkspaceRoot();
      if (!workspaceRoot || !getAutomationSettings().enableFileWatchRefresh) {
        return;
      }
      if (!event.files.some((uri) => uri.scheme === "file" && shouldRefreshProjectMemoryForPath(workspaceRoot, uri.fsPath))) {
        return;
      }

      refreshCoordinator.scheduleRefresh("files deleted");
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      const workspaceRoot = getPrimaryWorkspaceRoot();
      if (!workspaceRoot || !getAutomationSettings().enableFileWatchRefresh) {
        return;
      }
      if (!event.files.some((entry) => (
        (entry.oldUri.scheme === "file" && shouldRefreshProjectMemoryForPath(workspaceRoot, entry.oldUri.fsPath))
        || (entry.newUri.scheme === "file" && shouldRefreshProjectMemoryForPath(workspaceRoot, entry.newUri.fsPath))
      ))) {
        return;
      }

      refreshCoordinator.scheduleRefresh("files renamed");
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshCoordinator.refreshNow("workspace changed");
      void refreshStatus("workspace changed");
    }),
    {
      dispose: () => {
        refreshCoordinator.dispose();
        void toolProviderRegistry?.disposeAll();
        toolProviderRegistry = undefined;
        tokenSaviorProvider = undefined;
        gateway = undefined;
        providerRegistry = undefined;
      },
    },
  );

  await refreshCoordinator.refreshNow("activate");
  void refreshStatus("activate");
}

export async function deactivate(): Promise<void> {
  await toolProviderRegistry?.disposeAll();
  toolProviderRegistry = undefined;
  tokenSaviorProvider = undefined;
  gateway = undefined;
  providerRegistry = undefined;
}