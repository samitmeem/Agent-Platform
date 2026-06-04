import * as vscode from "vscode";

import type { AutomationSettings } from "../config";
import type { SessionStore } from "../state/sessionStore";
import type { TelemetrySnapshot } from "../state/telemetryState";
import type { LastCheckpointRecord } from "../state/workspaceStore";
import type {
  WorkspacePhaseAssessment,
  WorkspaceProjectMode,
  WorkspaceProjectMemory,
  WorkspaceProfile,
  WorkspaceRefreshState,
  WorkspaceSuggestion,
} from "../state/workspaceAnalysis";
import { buildObservabilityHtml } from "./observabilityRenderer";
import type { ObservabilityPanelSnapshot } from "../testing/extensionTestHarness";

export function showObservabilityPanel(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore,
  telemetry: TelemetrySnapshot,
  runId?: string,
  lastCheckpoint?: LastCheckpointRecord,
  workspaceProfile?: WorkspaceProfile,
  workspacePhase?: WorkspacePhaseAssessment,
  workspaceRefresh?: WorkspaceRefreshState,
  workspaceProjectMode?: WorkspaceProjectMode,
  workspaceProjectMemory?: WorkspaceProjectMemory,
  automationSettings?: AutomationSettings,
  workspaceSuggestions: WorkspaceSuggestion[] = [],
  onDidRender?: (snapshot: ObservabilityPanelSnapshot) => void,
): void {
  const panel = vscode.window.createWebviewPanel(
    "agentPlatform.observability",
    "Agent-Platform Observability",
    vscode.ViewColumn.Beside,
    {
      enableFindWidget: true,
      retainContextWhenHidden: true,
    },
  );

  panel.webview.html = buildObservabilityHtml(
    sessionStore,
    telemetry,
    runId,
    lastCheckpoint,
    workspaceProfile,
    workspacePhase,
    workspaceRefresh,
    workspaceProjectMode,
    workspaceProjectMemory,
    automationSettings,
    workspaceSuggestions,
  );
  onDidRender?.({
    viewType: "agentPlatform.observability",
    title: panel.title,
    html: panel.webview.html,
    visible: panel.visible,
  });
}
