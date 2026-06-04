import test from "node:test";
import assert from "node:assert/strict";

import {
  createApprovedWorkflowRecord,
  deriveWorkspaceProjectMode,
  formatWorkspaceProjectMode,
  upsertApprovedWorkflow,
} from "../agent/projectMode";
import type { StoredPreviewRun } from "../state/sessionStore";
import type { WorkspaceProfile } from "../state/workspaceAnalysis";

function createProfile(overrides?: Partial<WorkspaceProfile>): WorkspaceProfile {
  return {
    workspaceRoot: "C:/repo",
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
    generatedAt: "2026-05-11T09:00:00.000Z",
    ...overrides,
  };
}

function createActionRun(): StoredPreviewRun {
  return {
    id: "action-run-1",
    query: "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
    answer: "Validation passed and a checkpoint was created.",
    createdAt: "2026-05-11T09:00:05.000Z",
    startedAt: "2026-05-11T09:00:00.000Z",
    durationMs: 5000,
    source: "command",
    outcome: "completed",
    activeFilePath: "src/extension.ts",
    result: {
      query: "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
      mode: "action",
      plan: {
        kind: "tool",
        toolName: "apply_symbol_change_and_validate",
        arguments: {
          symbol_name: "TokenSaviorService.invoke_tool",
        },
        reasoning: "Apply the requested change.",
        source: "heuristic",
      },
      plans: [
        {
          kind: "tool",
          toolName: "apply_symbol_change_and_validate",
          arguments: {
            symbol_name: "TokenSaviorService.invoke_tool",
          },
          reasoning: "Apply the requested change.",
          source: "heuristic",
        },
      ],
      answer: "Validation passed and a checkpoint was created.",
      trace: [],
    },
  };
}

test("deriveWorkspaceProjectMode persists the latest approved workflow and validation milestone", () => {
  const result = deriveWorkspaceProjectMode({
    profile: createProfile(),
    phase: {
      phase: "implementation",
      confidence: 0.81,
      reasons: ["Source directories and tests are present."],
      updatedAt: "2026-05-11T09:00:01.000Z",
    },
    projectMemory: {
      purpose: "Keep project context fresh across sessions.",
      stackSummary: "Repo type: node-typescript. Current phase: implementation.",
      conventions: ["Keep edits approval-gated."],
      availableTestCommands: ["npm test"],
      dangerousAreas: ["package.json"],
      currentGoals: ["Run npm test after impactful changes."],
      canonicalSources: ["README.md"],
      summary: "Purpose: Keep project context fresh across sessions.",
      summaryFingerprint: "mode-summary-1",
      sectionFingerprints: { stackSummary: "stack-1" },
      updatedAt: "2026-05-11T09:00:02.000Z",
    },
    recentRuns: [createActionRun()],
    createdAt: "2026-05-11T09:00:06.000Z",
  });

  assert.equal(result.snapshot.goal, "Run npm test after impactful changes.");
  assert.ok(result.snapshot.lastApprovedWorkflow?.toolSequence.includes("apply_symbol_change_and_validate"));
  assert.ok(result.snapshot.milestones.some((milestone) => /validate the latest approved workflow with npm test/i.test(milestone.title)));
  assert.match(formatWorkspaceProjectMode(result.snapshot), /Last approved workflow:/);
});

test("deriveWorkspaceProjectMode preserves a newer stored workflow when recent runs are older", () => {
  const newerWorkflow = createApprovedWorkflowRecord({
    query: "Run impacted tests after the latest workflow",
    toolSequence: ["run_impacted_tests"],
    summary: "2 impacted tests passed.",
    outcome: "completed",
    startedAt: "2026-05-11T09:10:00.000Z",
    completedAt: "2026-05-11T09:10:10.000Z",
    activeFilePath: "src/extension.ts",
  });
  const previousSnapshot = upsertApprovedWorkflow(undefined, newerWorkflow, "2026-05-11T09:10:10.000Z");

  const result = deriveWorkspaceProjectMode({
    profile: createProfile(),
    recentRuns: [createActionRun()],
    previousSnapshot,
    createdAt: "2026-05-11T09:10:30.000Z",
  });

  assert.equal(result.snapshot.lastApprovedWorkflow?.query, "Run impacted tests after the latest workflow");
  assert.ok(result.snapshot.lastApprovedWorkflow?.toolSequence.includes("run_impacted_tests"));
});