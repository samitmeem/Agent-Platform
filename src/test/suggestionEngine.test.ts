import test from "node:test";
import assert from "node:assert/strict";

import { deriveWorkspaceSuggestions } from "../agent/suggestionEngine";
import type { StoredPreviewRun } from "../state/sessionStore";
import type { WorkspaceProfile } from "../state/workspaceAnalysis";

function createProfile(overrides?: Partial<WorkspaceProfile>): WorkspaceProfile {
  return {
    workspaceRoot: "C:/repo",
    repoType: "node-typescript",
    languages: ["TypeScript"],
    frameworks: ["VS Code Extension"],
    packageManagers: ["npm"],
    testFrameworks: [],
    availableTestCommands: [],
    hasDocker: false,
    hasCi: true,
    hasEnvFiles: false,
    hasInstructionDocs: true,
    hasChangelog: true,
    sourceDirectories: ["src"],
    testDirectories: [],
    riskAreas: ["package.json", ".github/workflows"],
    likelyActions: ["npm test", "npm run package"],
    generatedAt: "2026-05-11T08:00:00.000Z",
    ...overrides,
  };
}

function createRun(overrides?: Partial<StoredPreviewRun>): StoredPreviewRun {
  return {
    id: "run-1",
    query: "Run impacted tests for TokenSaviorService",
    answer: "2 impacted tests failed.",
    createdAt: "2026-05-11T08:01:00.000Z",
    source: "command",
    outcome: "failed",
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
      answer: "2 impacted tests failed.",
      toolResult: {
        name: "run_impacted_tests",
        ok: false,
        content: ["2 impacted tests failed."],
        error: "2 impacted tests failed.",
      },
      trace: [],
    },
    ...overrides,
  };
}

test("deriveWorkspaceSuggestions prioritizes refresh failures, validation failures, missing tests, and actions", () => {
  const suggestions = deriveWorkspaceSuggestions({
    profile: createProfile(),
    phase: {
      phase: "implementation",
      confidence: 0.82,
      reasons: ["Source directories exist."],
      updatedAt: "2026-05-11T08:02:00.000Z",
    },
    projectMemory: {
      purpose: "Keep project context fresh across sessions.",
      stackSummary: "Repo type: node-typescript. Current phase: implementation.",
      conventions: ["Keep edits approval-gated."],
      availableTestCommands: [],
      dangerousAreas: ["package.json"],
      currentGoals: ["Review release-sensitive files before shipping."],
      canonicalSources: ["README.md"],
      summary: "Purpose: Keep project context fresh across sessions.",
      summaryFingerprint: "summary",
      sectionFingerprints: { stackSummary: "stack" },
      updatedAt: "2026-05-11T08:02:01.000Z",
    },
    refresh: {
      status: "error",
      stale: true,
      warnings: ["Workspace profile is stale."],
      lastRefreshAt: "2026-05-11T08:02:02.000Z",
      lastSuccessfulRefreshAt: "2026-05-11T08:00:00.000Z",
      lastError: "Workspace bootstrap timed out after 4000 ms.",
    },
    recentRuns: [createRun()],
    lastApprovedWorkflow: {
      query: "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
      toolSequence: ["apply_symbol_change_and_validate"],
      summary: "Validation passed and a checkpoint was created.",
      outcome: "completed",
      startedAt: "2026-05-11T08:01:30.000Z",
      completedAt: "2026-05-11T08:01:59.000Z",
      activeFilePath: "src/extension.ts",
    },
    discoveredActions: [
      { label: "npm test", kind: "test", description: "Run the main test suite.", runnable: true },
    ],
    maxSuggestions: 8,
    createdAt: "2026-05-11T08:02:03.000Z",
  });

  assert.equal(suggestions[0]?.title, "Resolve the latest workspace refresh failure");
  assert.ok(suggestions.some((suggestion) => suggestion.title === "Fix recent validation failures before new feature work"));
  assert.ok(suggestions.some((suggestion) => suggestion.title === "Run impacted tests after the latest approved workflow"));
  assert.ok(suggestions.some((suggestion) => suggestion.title === "Add or document a test harness before broader implementation"));
  assert.ok(suggestions.some((suggestion) => suggestion.title === "Document required runtime configuration or env variables"));
  assert.ok(suggestions.some((suggestion) => suggestion.title === "Run available validation step: npm test"));
});

test("deriveWorkspaceSuggestions keeps continuity goals and recent successful work in the ranked list", () => {
  const suggestions = deriveWorkspaceSuggestions({
    profile: createProfile({
      availableTestCommands: ["npm test"],
      testFrameworks: ["Node Test Runner"],
      testDirectories: ["src/test"],
      hasEnvFiles: true,
    }),
    phase: {
      phase: "maintenance",
      confidence: 0.75,
      reasons: ["Tests and CI are already present."],
      updatedAt: "2026-05-11T08:10:00.000Z",
    },
    projectMemory: {
      purpose: "Keep project context fresh across sessions.",
      stackSummary: "Repo type: node-typescript. Current phase: maintenance.",
      conventions: ["Keep edits approval-gated."],
      availableTestCommands: ["npm test"],
      dangerousAreas: ["package.json"],
      currentGoals: ["Run npm test after impactful changes."],
      canonicalSources: ["README.md"],
      summary: "Purpose: Keep project context fresh across sessions.",
      summaryFingerprint: "summary-2",
      sectionFingerprints: { stackSummary: "stack-2" },
      updatedAt: "2026-05-11T08:10:01.000Z",
    },
    recentRuns: [createRun({
      id: "run-2",
      outcome: "completed",
      query: "Apply the selected text to TokenSaviorService.invoke_tool and validate",
      answer: "Validation passed.",
      result: {
        query: "Apply the selected text to TokenSaviorService.invoke_tool and validate",
        mode: "action",
        plan: {
          kind: "tool",
          toolName: "apply_symbol_change_and_validate",
          arguments: {},
          reasoning: "Validate the approved change.",
          source: "heuristic",
        },
        answer: "Validation passed.",
        trace: [],
      },
    })],
    maxSuggestions: 5,
    createdAt: "2026-05-11T08:10:02.000Z",
  });

  assert.ok(suggestions.some((suggestion) => suggestion.title === "Run npm test after impactful changes."));
  assert.ok(suggestions.some((suggestion) => suggestion.title === "Continue from the most recent completed work"));
});
