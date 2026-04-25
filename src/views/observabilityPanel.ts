import * as vscode from "vscode";

import type { SessionStore } from "../state/sessionStore";
import type { TelemetrySnapshot } from "../state/telemetryState";
import type { LastCheckpointRecord } from "../state/workspaceStore";
import { buildObservabilityHtml } from "./observabilityRenderer";
import type { ObservabilityPanelSnapshot } from "../testing/extensionTestHarness";

export function showObservabilityPanel(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore,
  telemetry: TelemetrySnapshot,
  runId?: string,
  lastCheckpoint?: LastCheckpointRecord,
  onDidRender?: (snapshot: ObservabilityPanelSnapshot) => void,
): void {
  const panel = vscode.window.createWebviewPanel(
    "agentPlatform.observability",
    "Token Savior Observability",
    vscode.ViewColumn.Beside,
    {
      enableFindWidget: true,
      retainContextWhenHidden: true,
    },
  );

  panel.webview.html = buildObservabilityHtml(sessionStore, telemetry, runId, lastCheckpoint);
  onDidRender?.({
    viewType: "agentPlatform.observability",
    title: panel.title,
    html: panel.webview.html,
    visible: panel.visible,
  });
}
