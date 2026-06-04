import { formatTraceEntries } from "../agent/trace";
import { formatWorkspaceProjectMode } from "../agent/projectMode";
import { formatStoredPreviewRunBody } from "../state/sessionPresentation";
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
  workspaceProfile?: WorkspaceProfile,
  workspacePhase?: WorkspacePhaseAssessment,
  workspaceRefresh?: WorkspaceRefreshState,
  workspaceProjectMode?: WorkspaceProjectMode,
  workspaceProjectMemory?: WorkspaceProjectMemory,
  automationSettings?: AutomationSettings,
  workspaceSuggestions: WorkspaceSuggestion[] = [],
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
  const workspaceProfileSummary = workspaceProfile
    ? [
      `Repo type: ${workspaceProfile.repoType}`,
      `Languages: ${workspaceProfile.languages.join(", ") || "—"}`,
      `Frameworks: ${workspaceProfile.frameworks.join(", ") || "—"}`,
      `Package managers: ${workspaceProfile.packageManagers.join(", ") || "—"}`,
      `Test frameworks: ${workspaceProfile.testFrameworks.join(", ") || "—"}`,
      `Test commands: ${workspaceProfile.availableTestCommands.join(", ") || "—"}`,
      `Source directories: ${workspaceProfile.sourceDirectories.join(", ") || "—"}`,
      `Test directories: ${workspaceProfile.testDirectories.join(", ") || "—"}`,
      `Instruction docs: ${workspaceProfile.hasInstructionDocs ? "yes" : "no"}`,
      `CI detected: ${workspaceProfile.hasCi ? "yes" : "no"}`,
      `Docker detected: ${workspaceProfile.hasDocker ? "yes" : "no"}`,
      `Env files detected: ${workspaceProfile.hasEnvFiles ? "yes" : "no"}`,
      `Changelog detected: ${workspaceProfile.hasChangelog ? "yes" : "no"}`,
      `Risk areas: ${workspaceProfile.riskAreas.join(", ") || "—"}`,
      `Likely actions: ${workspaceProfile.likelyActions.join(", ") || "—"}`,
      `Generated at: ${workspaceProfile.generatedAt}`,
    ].join("\n")
    : "No workspace profile recorded yet.";
  const workspacePhaseSummary = workspacePhase
    ? [
      `Phase: ${workspacePhase.phase}`,
      `Confidence: ${Math.round(workspacePhase.confidence * 100)}%`,
      "Reasons:",
      ...workspacePhase.reasons.map((reason) => `- ${reason}`),
      `Updated at: ${workspacePhase.updatedAt}`,
    ].join("\n")
    : "No lifecycle phase recorded yet.";
  const workspaceRefreshSummary = workspaceRefresh
    ? [
      `Status: ${workspaceRefresh.status}`,
      `Stale: ${workspaceRefresh.stale ? "yes" : "no"}`,
      workspaceRefresh.lastRefreshAt ? `Last refresh: ${workspaceRefresh.lastRefreshAt}` : undefined,
      workspaceRefresh.lastSuccessfulRefreshAt ? `Last successful refresh: ${workspaceRefresh.lastSuccessfulRefreshAt}` : undefined,
      workspaceRefresh.lastError ? `Last error: ${workspaceRefresh.lastError}` : undefined,
      "Warnings:",
      ...(workspaceRefresh.warnings.length > 0 ? workspaceRefresh.warnings.map((warning) => `- ${warning}`) : ["- none"]),
    ].filter(Boolean).join("\n")
    : "No refresh state recorded yet.";
  const workspaceProjectMemorySummary = workspaceProjectMemory
    ? workspaceProjectMemory.summary
    : "No workspace project memory recorded yet.";
  const workspaceProjectModeSummary = formatWorkspaceProjectMode(workspaceProjectMode);
  const automationSummary = automationSettings
    ? [
      `Profile: ${automationSettings.profile}`,
      `Automatic project memory refresh: ${automationSettings.enableAutomaticProjectMemory ? "enabled" : "disabled"}`,
      `Automatic suggestions: ${automationSettings.enableAutomaticSuggestions ? "enabled" : "disabled"}`,
      `Automatic project-mode refresh: ${automationSettings.enableAutomaticProjectModeRefresh ? "enabled" : "disabled"}`,
      `File-watch refresh: ${automationSettings.enableFileWatchRefresh ? "enabled" : "disabled"}`,
      `Refresh debounce: ${automationSettings.refreshDebounceMs} ms`,
      `Profile scan entry limit: ${automationSettings.profileScanEntryLimit}`,
      `Project memory source limit: ${automationSettings.projectMemorySourceFileLimit}`,
      `Action discovery limit: ${automationSettings.actionDiscoveryLimit}`,
      `Suggestion cap: ${automationSettings.maxWorkspaceSuggestions}`,
      `Context bundle cap: ${automationSettings.maxContextBundleChars} chars`,
      `Stale threshold: ${automationSettings.staleStateThresholdMinutes} min`,
      `Suggestion noise threshold: ${automationSettings.suggestionNoiseThreshold}`,
      `Tool timeout: ${automationSettings.toolTimeoutMs} ms`,
    ].join("\n")
    : "No automation settings loaded yet.";
  const workspaceSuggestionsSummary = workspaceSuggestions.length > 0
    ? workspaceSuggestions.map((suggestion) => [
      `- [${suggestion.priority}] ${suggestion.title}`,
      `  Source: ${suggestion.source}`,
      `  Reason: ${suggestion.reason}`,
      `  Created: ${suggestion.createdAt}`,
    ].join("\n")).join("\n")
    : "No workspace suggestions recorded yet.";
  const automationTelemetrySummary = [
    `Automation profile: ${telemetry.automationProfile ?? automationSettings?.profile ?? "—"}`,
    `Workspace refreshes: ${telemetry.workspaceRefreshes}`,
    `Refresh failures: ${telemetry.workspaceRefreshFailures}`,
    `Stale refreshes: ${telemetry.staleRefreshes}`,
    `Phase changes detected: ${telemetry.phaseChanges}`,
    `Suggestion refreshes: ${telemetry.suggestionRefreshes}`,
    `Suggestion churn events: ${telemetry.suggestionChurnEvents}`,
    telemetry.lastRefreshReason ? `Last refresh reason: ${telemetry.lastRefreshReason}` : "No refresh reason recorded yet.",
    telemetry.lastSuggestionChurnSummary ? `Last suggestion churn: ${telemetry.lastSuggestionChurnSummary}` : "No noisy suggestion churn recorded yet.",
  ].join("\n");

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Agent-Platform Observability</title>
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
      <h1>Agent-Platform Observability</h1>
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
        ${renderMetric("Refresh failures", telemetry.workspaceRefreshFailures)}
        ${renderMetric("Suggestion churn", telemetry.suggestionChurnEvents)}
        ${renderMetric("Milestones", workspaceProjectMode?.milestones.length ?? 0)}
        ${renderMetric("Suggestions", workspaceSuggestions.length)}
      </div>

      <h2>Provider usage</h2>
      <ul>${providerUsage || "<li>No provider usage recorded yet.</li>"}</ul>

      <h2>Latest run summary</h2>
      <pre>${escapeHtml(runSummary)}</pre>

      <h2>Latest run trace</h2>
      <pre>${escapeHtml(runTrace)}</pre>

      <h2>Latest checkpoint</h2>
      <pre>${escapeHtml(checkpointSummary)}</pre>

      <h2>Workspace profile</h2>
      <pre>${escapeHtml(workspaceProfileSummary)}</pre>

      <h2>Lifecycle phase</h2>
      <pre>${escapeHtml(workspacePhaseSummary)}</pre>

      <h2>Indexing and freshness</h2>
      <pre>${escapeHtml(workspaceRefreshSummary)}</pre>

      <h2>Automation profile</h2>
      <pre>${escapeHtml(automationSummary)}</pre>

      <h2>Project mode</h2>
      <pre>${escapeHtml(workspaceProjectModeSummary)}</pre>

      <h2>Project memory summary</h2>
      <pre>${escapeHtml(workspaceProjectMemorySummary)}</pre>

      <h2>Top suggestions</h2>
      <pre>${escapeHtml(workspaceSuggestionsSummary)}</pre>

      <h2>Automation telemetry</h2>
      <pre>${escapeHtml(automationTelemetrySummary)}</pre>

      <h2>Recovery + failure notes</h2>
      <pre>${escapeHtml([
        telemetry.lastRecoveryMessage ? `Last recovery: ${telemetry.lastRecoveryMessage}` : "No recovery events recorded.",
        telemetry.lastFailureMessage ? `Last failure: ${telemetry.lastFailureMessage}` : "No failures recorded.",
        telemetry.lastRunAt ? `Last run at: ${telemetry.lastRunAt}` : "No run timestamp recorded yet.",
      ].join("\n"))}</pre>
    </body>
  </html>`;
}
