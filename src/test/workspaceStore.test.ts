import test from "node:test";
import assert from "node:assert/strict";

import { SessionStore } from "../state/sessionStore";
import { WorkspaceStore } from "../state/workspaceStore";
import type { WorkspaceProfile } from "../state/workspaceAnalysis";

class FakeMemento {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue?: T): T {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T;
  }

  public update(key: string, value: unknown): Thenable<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

test("WorkspaceStore hydrates and persists preview runs", async () => {
  const memento = new FakeMemento();
  const workspaceStore = new WorkspaceStore(memento as never);
  const sessionStore = new SessionStore(5);

  sessionStore.savePreviewRun({
    id: "run-1",
    query: "What is this project about?",
    answer: "A backend plus VS Code extension.",
    createdAt: "2026-04-24T00:00:00.000Z",
    result: {
      query: "What is this project about?",
      plan: {
        kind: "direct",
        response: "A backend plus VS Code extension.",
        reasoning: "summary",
        source: "heuristic",
      },
      answer: "A backend plus VS Code extension.",
      trace: [],
    },
  });

  await workspaceStore.persistPreviewRuns(sessionStore.listPreviewRuns());

  const restoredStore = new SessionStore(5);
  workspaceStore.hydrateSessionStore(restoredStore);

  assert.equal(restoredStore.getLastPreviewRun()?.id, "run-1");
});

test("WorkspaceStore remembers the last checkpoint record", async () => {
  const memento = new FakeMemento();
  const workspaceStore = new WorkspaceStore(memento as never);

  await workspaceStore.saveLastCheckpoint({
    checkpointId: "ckpt-1",
    createdAt: "2026-04-24T00:00:00.000Z",
    filePath: "src/service.py",
  });

  assert.equal(workspaceStore.getLastCheckpoint()?.checkpointId, "ckpt-1");

  await workspaceStore.clearLastCheckpoint();
  assert.equal(workspaceStore.getLastCheckpoint(), undefined);
});

test("WorkspaceStore remembers and clears the active run record", async () => {
  const memento = new FakeMemento();
  const workspaceStore = new WorkspaceStore(memento as never);

  await workspaceStore.saveActiveRun({
    id: "run-active",
    query: "Run impacted tests for TokenSaviorService",
    mode: "action",
    source: "command",
    startedAt: "2026-04-24T12:00:00.000Z",
    activeFilePath: "src/token_savior/service_api/service.py",
  });

  assert.equal(workspaceStore.getActiveRun()?.id, "run-active");
  await workspaceStore.clearActiveRun();
  assert.equal(workspaceStore.getActiveRun(), undefined);
});

test("WorkspaceStore persists workspace profile, phase, and refresh state", async () => {
  const memento = new FakeMemento();
  const workspaceStore = new WorkspaceStore(memento as never);
  const profile: WorkspaceProfile = {
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
    likelyActions: ["npm test"],
    generatedAt: "2026-05-11T00:00:00.000Z",
  };

  await workspaceStore.saveWorkspaceProfile(profile);
  await workspaceStore.saveWorkspacePhase({
    phase: "maintenance",
    confidence: 0.8,
    reasons: ["Tests and CI were detected."],
    updatedAt: "2026-05-11T00:00:01.000Z",
  });
  await workspaceStore.saveWorkspaceRefreshState({
    status: "ready",
    stale: false,
    warnings: ["none"],
    lastRefreshAt: "2026-05-11T00:00:02.000Z",
    lastSuccessfulRefreshAt: "2026-05-11T00:00:02.000Z",
  });
  await workspaceStore.saveWorkspaceProjectMode({
    goal: "Run npm test after impactful changes.",
    milestones: [
      {
        id: "validation:npm-test",
        title: "Validate the latest approved workflow with npm test",
        reason: "The latest approved workflow changed workspace state.",
        source: "validation",
        createdAt: "2026-05-11T00:00:02.500Z",
      },
    ],
    completedMilestoneIds: [],
    lastApprovedWorkflow: {
      query: "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
      toolSequence: ["apply_symbol_change_and_validate"],
      summary: "Validation passed and a checkpoint was created.",
      outcome: "completed",
      startedAt: "2026-05-11T00:00:02.250Z",
      completedAt: "2026-05-11T00:00:02.750Z",
      activeFilePath: "src/extension.ts",
    },
    updatedAt: "2026-05-11T00:00:02.750Z",
  });
  await workspaceStore.saveWorkspaceProjectMemory({
    purpose: "Keep project context fresh.",
    stackSummary: "Repo type: node-typescript. Current phase: maintenance.",
    conventions: ["Keep edits approval-gated."],
    availableTestCommands: ["npm test"],
    dangerousAreas: ["package.json"],
    currentGoals: ["Run npm test after impactful changes."],
    canonicalSources: ["README.md"],
    summary: "Purpose: Keep project context fresh.",
    summaryFingerprint: "fingerprint-1",
    sectionFingerprints: {
      purpose: "fingerprint-purpose",
      stackSummary: "fingerprint-stack",
    },
    updatedAt: "2026-05-11T00:00:03.000Z",
  });
  await workspaceStore.saveWorkspaceSuggestions([
    {
      id: "tests:add-harness",
      title: "Add or document a test harness before broader implementation",
      reason: "No test framework was detected yet.",
      priority: "high",
      source: "tests",
      createdAt: "2026-05-11T00:00:04.000Z",
    },
  ]);

  assert.equal(workspaceStore.getWorkspaceProfile()?.repoType, "node-typescript");
  assert.equal(workspaceStore.getWorkspacePhase()?.phase, "maintenance");
  assert.equal(workspaceStore.getWorkspaceRefreshState().status, "ready");
  assert.equal(workspaceStore.getWorkspaceProjectMode()?.lastApprovedWorkflow?.outcome, "completed");
  assert.match(workspaceStore.getWorkspaceProjectMemory()?.summary ?? "", /Purpose: Keep project context fresh\./);
  assert.equal(workspaceStore.getWorkspaceSuggestions()[0]?.priority, "high");
});
