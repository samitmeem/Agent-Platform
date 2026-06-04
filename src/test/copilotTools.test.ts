import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCopilotContextBundle,
  deriveCopilotNextActions,
  deriveWorkspaceProjectActionSuggestions,
  mergeCopilotProjectActions,
  parseDiscoveredProjectActions,
  type CopilotWorkspaceStateSnapshot,
} from "../agent/copilotToolState";
import type { StoredPreviewRun } from "../state/sessionStore";

function createRun(overrides?: Partial<StoredPreviewRun>): StoredPreviewRun {
  return {
    id: "run-1",
    query: "Summarize the current project state",
    answer: "The workspace is a VS Code extension with project-memory support.",
    createdAt: "2026-05-11T07:30:00.000Z",
    startedAt: "2026-05-11T07:29:58.000Z",
    durationMs: 1500,
    source: "command",
    outcome: "completed",
    activeFilePath: "src/extension.ts",
    result: {
      query: "Summarize the current project state",
      mode: "preview",
      plan: {
        kind: "tool",
        toolName: "get_context_bundle",
        arguments: {},
        reasoning: "Use the bounded context bundle.",
        source: "heuristic",
      },
      plans: [
        {
          kind: "tool",
          toolName: "get_context_bundle",
          arguments: {},
          reasoning: "Use the bounded context bundle.",
          source: "heuristic",
        },
      ],
      answer: "The workspace is a VS Code extension with project-memory support.",
      providerKind: "copilot",
      trace: [],
    },
    ...overrides,
  };
}

function createSnapshot(overrides?: Partial<CopilotWorkspaceStateSnapshot>): CopilotWorkspaceStateSnapshot {
  return {
    workspaceRoot: "C:/repo",
    profile: {
      workspaceRoot: "C:/repo",
      repoType: "node-typescript",
      languages: ["TypeScript"],
      frameworks: ["VS Code Extension"],
      packageManagers: ["npm"],
      testFrameworks: ["Node Test Runner", "VS Code Extension Host"],
      availableTestCommands: ["npm test", "npm run test:extension-host"],
      hasDocker: false,
      hasCi: true,
      hasEnvFiles: false,
      hasInstructionDocs: true,
      hasChangelog: true,
      sourceDirectories: ["src"],
      testDirectories: ["src/test"],
      riskAreas: ["package.json", "src/extension.ts"],
      likelyActions: ["npm test", "npm run package"],
      generatedAt: "2026-05-11T07:25:00.000Z",
    },
    phase: {
      phase: "implementation",
      confidence: 0.82,
      reasons: ["Source directories exist.", "Tests and CI already exist."],
      updatedAt: "2026-05-11T07:25:10.000Z",
    },
    refresh: {
      status: "ready",
      stale: false,
      warnings: ["Workspace profile is fresh."],
      lastRefreshAt: "2026-05-11T07:25:11.000Z",
      lastSuccessfulRefreshAt: "2026-05-11T07:25:11.000Z",
    },
    projectMode: {
      goal: "Run npm test after impactful changes.",
      milestones: [
        {
          id: "validation:npm-test",
          title: "Validate the latest approved workflow with npm test",
          reason: "The latest approved workflow changed workspace state.",
          source: "validation",
          createdAt: "2026-05-11T07:25:11.500Z",
        },
      ],
      completedMilestoneIds: [],
      lastApprovedWorkflow: {
        query: "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
        toolSequence: ["apply_symbol_change_and_validate"],
        summary: "Validation passed and a checkpoint was created.",
        outcome: "completed",
        startedAt: "2026-05-11T07:25:11.250Z",
        completedAt: "2026-05-11T07:25:11.750Z",
        activeFilePath: "src/extension.ts",
      },
      updatedAt: "2026-05-11T07:25:11.750Z",
    },
    projectMemory: {
      purpose: "Keep project context fresh across sessions.",
      stackSummary: "Repo type: node-typescript. Current phase: implementation.",
      conventions: ["Keep edits approval-gated."],
      availableTestCommands: ["npm test"],
      dangerousAreas: ["package.json"],
      currentGoals: ["Run npm test after impactful changes."],
      canonicalSources: ["README.md", ".github/copilot-instructions.md"],
      summary: "Purpose: Keep project context fresh across sessions.\n\nCurrent goals:\n- Run npm test after impactful changes.",
      summaryFingerprint: "memory-fingerprint",
      sectionFingerprints: {
        purpose: "purpose-fingerprint",
        stackSummary: "stack-fingerprint",
      },
      updatedAt: "2026-05-11T07:25:12.000Z",
    },
    suggestions: [
      {
        id: "validation:run-tests",
        title: "Run npm test after impactful changes.",
        reason: "The extension-owned project memory marked validation as a current goal.",
        priority: "high",
        source: "continuity",
        createdAt: "2026-05-11T07:25:13.000Z",
      },
    ],
    recentRuns: [createRun()],
    ...overrides,
  };
}

test("deriveCopilotNextActions combines refresh issues, project goals, phase hints, and likely actions", () => {
  const snapshot = createSnapshot({
    refresh: {
      status: "error",
      stale: true,
      warnings: ["Workspace profile is stale."],
      lastRefreshAt: "2026-05-11T07:28:00.000Z",
      lastSuccessfulRefreshAt: "2026-05-11T07:20:00.000Z",
      lastError: "Workspace bootstrap timed out after 4000 ms.",
    },
  });

  const actions = deriveCopilotNextActions(snapshot, 8);

  assert.equal(actions[0], "Run npm test after impactful changes.");
});

test("buildCopilotContextBundle includes state-backed profile, phase, memory, recent runs, and warnings", () => {
  const snapshot = createSnapshot();

  const bundle = buildCopilotContextBundle(snapshot, { maxActions: 4, maxRuns: 1 });

  assert.match(bundle, /Workspace root: C:\/repo/);
  assert.match(bundle, /Repo type: node-typescript/);
  assert.match(bundle, /Phase: implementation/);
  assert.match(bundle, /Project memory summary:/);
  assert.match(bundle, /Keep project context fresh across sessions/);
  assert.match(bundle, /Recent run summary:/);
  assert.match(bundle, /Summarize the current project state/);
  assert.match(bundle, /Warnings:/);
  assert.match(bundle, /Workspace profile is fresh/);
  assert.match(bundle, /Next actions:/);
  assert.match(bundle, /Project mode:/);
  assert.match(bundle, /Last approved workflow:/);
  assert.match(bundle, /Suggestion details:/);
});

test("project action helpers dedupe state suggestions and merge backend runnable actions", () => {
  const snapshot = createSnapshot();
  const stateActions = deriveWorkspaceProjectActionSuggestions(snapshot, 10);
  const backendActions = parseDiscoveredProjectActions({
    name: "discover_project_actions",
    ok: true,
    content: [JSON.stringify([
      { id: "npm test", kind: "test", description: "Run the main test suite." },
      { id: "python:lint", kind: "quality", description: "Run the Python lint target." },
    ])],
  });

  const merged = mergeCopilotProjectActions(stateActions, backendActions, 10);

  assert.equal(merged.filter((action) => action.label === "npm test").length, 1);
  assert.ok(merged.some((action) => action.label === "npm test" && action.source === "workspace-state"));
  assert.ok(merged.some((action) => action.label === "Validate the latest approved workflow with npm test"));
  assert.ok(merged.some((action) => action.label === "python:lint" && action.source === "backend" && action.runnable));
});
