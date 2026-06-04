import test from "node:test";
import assert from "node:assert/strict";

import { buildObservabilityHtml } from "../views/observabilityRenderer";
import { SessionStore } from "../state/sessionStore";

test("buildObservabilityHtml includes telemetry, run details, and checkpoint summary", () => {
  const store = new SessionStore();
  store.savePreviewRun({
    id: "obs-run-1",
    query: "Run impacted tests for TokenSaviorService",
    answer: "2 impacted tests passed.",
    createdAt: "2026-04-24T16:00:00.000Z",
    startedAt: "2026-04-24T15:59:58.000Z",
    durationMs: 2000,
    source: "command",
    outcome: "completed",
    result: {
      query: "Run impacted tests for TokenSaviorService",
      mode: "action",
      plan: {
        kind: "tool",
        toolName: "run_impacted_tests",
        arguments: { symbol_names: ["TokenSaviorService"] },
        reasoning: "Validate the changed symbol.",
        source: "heuristic",
      },
      answer: "2 impacted tests passed.",
      providerKind: "local",
      trace: [],
    },
  });

  const html = buildObservabilityHtml(store, {
    totalRuns: 2,
    previewRuns: 1,
    actionRuns: 1,
    chatRuns: 0,
    commandRuns: 2,
    completedRuns: 2,
    failedRuns: 0,
    cancelledRuns: 0,
    backendRestarts: 1,
    recoveryEvents: 1,
    totalToolCalls: 2,
    totalDurationMs: 2800,
    averageDurationMs: 1400,
    providerUsage: { local: 1, copilot: 1 },
    automationProfile: "balanced",
    workspaceRefreshes: 4,
    workspaceRefreshFailures: 1,
    staleRefreshes: 1,
    phaseChanges: 2,
    suggestionRefreshes: 3,
    suggestionChurnEvents: 1,
    lastRunAt: "2026-04-24T16:00:00.000Z",
    lastRecoveryMessage: "Recovered interrupted action run",
    lastFailureMessage: "Backend timeout",
    lastRefreshReason: "document saved",
    lastSuggestionChurnSummary: "Added: Fix recent validation failures",
  }, "obs-run-1", {
    checkpointId: "ckpt-obs-1",
    createdAt: "2026-04-24T15:59:59.000Z",
    filePath: "src/token_savior/service_api/service.py",
  }, {
    workspaceRoot: "c:/workspace",
    repoType: "node-typescript",
    languages: ["TypeScript"],
    frameworks: ["VS Code Extension"],
    packageManagers: ["npm"],
    testFrameworks: ["Node Test Runner"],
    availableTestCommands: ["npm test"],
    hasDocker: false,
    hasCi: true,
    hasEnvFiles: false,
    hasInstructionDocs: true,
    hasChangelog: true,
    sourceDirectories: ["src"],
    testDirectories: ["src/test"],
    riskAreas: ["package.json"],
    likelyActions: ["npm test", "npm run package"],
    generatedAt: "2026-04-24T15:59:58.000Z",
  }, {
    phase: "maintenance",
    confidence: 0.8,
    reasons: ["Tests, CI, and release workflows are present."],
    updatedAt: "2026-04-24T16:00:00.000Z",
  }, {
    status: "ready",
    stale: false,
    warnings: ["Workspace profile is fresh."],
    lastRefreshAt: "2026-04-24T16:00:00.000Z",
    lastSuccessfulRefreshAt: "2026-04-24T16:00:00.000Z",
  }, {
    goal: "Run npm test after impactful changes.",
    milestones: [
      {
        id: "validation:npm-test",
        title: "Validate the latest approved workflow with npm test",
        reason: "The latest approved workflow changed workspace state.",
        source: "validation",
        createdAt: "2026-04-24T16:00:00.500Z",
      },
    ],
    completedMilestoneIds: [],
    lastApprovedWorkflow: {
      query: "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
      toolSequence: ["apply_symbol_change_and_validate"],
      summary: "Validation passed and a checkpoint was created.",
      outcome: "completed",
      startedAt: "2026-04-24T15:59:59.000Z",
      completedAt: "2026-04-24T16:00:00.000Z",
      activeFilePath: "src/token_savior/service_api/service.py",
    },
    updatedAt: "2026-04-24T16:00:00.000Z",
  }, {
    purpose: "Keep project context fresh across sessions.",
    stackSummary: "Repo type: node-typescript. Current phase: maintenance.",
    conventions: ["Keep edits approval-gated."],
    availableTestCommands: ["npm test"],
    dangerousAreas: ["package.json"],
    currentGoals: ["Run npm test after impactful changes."],
    canonicalSources: ["README.md", ".github/copilot-instructions.md"],
    summary: "Purpose: Keep project context fresh across sessions.\n\nCurrent goals:\n- Run npm test after impactful changes.",
    summaryFingerprint: "fingerprint-obs",
    sectionFingerprints: {
      purpose: "purpose",
      stackSummary: "stack",
    },
    updatedAt: "2026-04-24T16:00:00.000Z",
  }, {
    profile: "balanced",
    refreshDebounceMs: 250,
    profileScanEntryLimit: 160,
    projectMemorySourceFileLimit: 16,
    actionDiscoveryLimit: 8,
    maxWorkspaceSuggestions: 6,
    maxContextBundleChars: 6000,
    staleStateThresholdMinutes: 60,
    suggestionNoiseThreshold: 3,
    enableAutomaticProjectMemory: true,
    enableAutomaticSuggestions: true,
    enableAutomaticProjectModeRefresh: true,
    enableFileWatchRefresh: true,
    toolTimeoutMs: 30000,
  }, [
    {
      id: "tests:add-harness",
      title: "Add or document a test harness before broader implementation",
      reason: "The workspace has source code but no detected test framework yet.",
      priority: "high",
      source: "tests",
      createdAt: "2026-04-24T16:00:01.000Z",
    },
  ]);

  assert.match(html, /Agent-Platform Observability/);
  assert.match(html, /Action runs/);
  assert.match(html, /Run impacted tests for TokenSaviorService/);
  assert.match(html, /ckpt-obs-1/);
  assert.match(html, /local/);
  assert.match(html, /Recovered interrupted action run/);
  assert.match(html, /Backend timeout/);
  assert.match(html, /Workspace profile/);
  assert.match(html, /node-typescript/);
  assert.match(html, /Lifecycle phase/);
  assert.match(html, /maintenance/);
  assert.match(html, /Indexing and freshness/);
  assert.match(html, /Automation profile/);
  assert.match(html, /balanced/);
  assert.match(html, /Project mode/);
  assert.match(html, /Last approved workflow/);
  assert.match(html, /Project memory summary/);
  assert.match(html, /Keep project context fresh across sessions/);
  assert.match(html, /Top suggestions/);
  assert.match(html, /Add or document a test harness before broader implementation/);
  assert.match(html, /Automation telemetry/);
  assert.match(html, /Refresh failures/);
});