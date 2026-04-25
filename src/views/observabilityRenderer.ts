import { formatTraceEntries } from "../agent/trace";
import { formatStoredPreviewRunBody } from "../state/sessionPresentation";
import type { SessionStore } from "../state/sessionStore";
import type { TelemetrySnapshot } from "../state/telemetryState";
import type { LastCheckpointRecord } from "../state/workspaceStore";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMetric(label: string, value: string | number | undefined): string {
  return `
    <div class="metric">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(String(value ?? "—"))}</div>
    </div>
  `;
}

export function buildObservabilityHtml(
  sessionStore: SessionStore,
  telemetry: TelemetrySnapshot,
  runId?: string,
  lastCheckpoint?: LastCheckpointRecord,
): string {
  const run = typeof runId === "string"
    ? sessionStore.getPreviewRun(runId) ?? sessionStore.getLastPreviewRun()
    : sessionStore.getLastPreviewRun();

  const providerUsage = Object.entries(telemetry.providerUsage)
    .map(([provider, count]) => `<li><strong>${escapeHtml(provider)}</strong>: ${count}</li>`)
    .join("");
  const runTrace = run ? formatTraceEntries(run.result.trace) : "<no run selected>";
  const runSummary = run ? formatStoredPreviewRunBody(run) : "No recorded run is available yet.";
  const checkpointSummary = lastCheckpoint
    ? [
      `Checkpoint id: ${lastCheckpoint.checkpointId}`,
      `Created at: ${lastCheckpoint.createdAt}`,
      lastCheckpoint.filePath ? `File: ${lastCheckpoint.filePath}` : undefined,
    ].filter(Boolean).join("\n")
    : "No checkpoint recorded yet.";

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Token Savior Observability</title>
      <style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
        h1, h2 { font-weight: 600; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .metric { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; background: var(--vscode-sideBar-background); }
        .metric-label { font-size: 12px; opacity: 0.8; margin-bottom: 6px; }
        .metric-value { font-size: 20px; font-weight: 700; }
        pre { white-space: pre-wrap; word-break: break-word; padding: 12px; border-radius: 6px; background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); }
      </style>
    </head>
    <body>
      <h1>Token Savior Observability</h1>
      <div class="grid">
        ${renderMetric("Total runs", telemetry.totalRuns)}
        ${renderMetric("Preview runs", telemetry.previewRuns)}
        ${renderMetric("Action runs", telemetry.actionRuns)}
        ${renderMetric("Completed", telemetry.completedRuns)}
        ${renderMetric("Failed", telemetry.failedRuns)}
        ${renderMetric("Cancelled", telemetry.cancelledRuns)}
        ${renderMetric("Backend restarts", telemetry.backendRestarts)}
        ${renderMetric("Recovery events", telemetry.recoveryEvents)}
        ${renderMetric("Tool calls", telemetry.totalToolCalls)}
        ${renderMetric("Avg duration (ms)", telemetry.averageDurationMs)}
      </div>

      <h2>Provider usage</h2>
      <ul>${providerUsage || "<li>No provider usage recorded yet.</li>"}</ul>

      <h2>Latest run summary</h2>
      <pre>${escapeHtml(runSummary)}</pre>

      <h2>Latest run trace</h2>
      <pre>${escapeHtml(runTrace)}</pre>

      <h2>Latest checkpoint</h2>
      <pre>${escapeHtml(checkpointSummary)}</pre>

      <h2>Recovery + failure notes</h2>
      <pre>${escapeHtml([
        telemetry.lastRecoveryMessage ? `Last recovery: ${telemetry.lastRecoveryMessage}` : "No recovery events recorded.",
        telemetry.lastFailureMessage ? `Last failure: ${telemetry.lastFailureMessage}` : "No failures recorded.",
        telemetry.lastRunAt ? `Last run at: ${telemetry.lastRunAt}` : "No run timestamp recorded yet.",
      ].join("\n"))}</pre>
    </body>
  </html>`;
}