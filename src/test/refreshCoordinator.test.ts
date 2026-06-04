import test from "node:test";
import assert from "node:assert/strict";

import { WorkspaceRefreshCoordinator } from "../agent/refreshCoordinator";
import { SessionStore } from "../state/sessionStore";
import { WorkspaceStore } from "../state/workspaceStore";
import type { WorkspaceProfile } from "../state/workspaceAnalysis";

function createAutomationSettings(overrides?: Partial<{
  profile: "conservative" | "balanced" | "aggressive-but-safe";
  refreshDebounceMs: number;
  profileScanEntryLimit: number;
  projectMemorySourceFileLimit: number;
  actionDiscoveryLimit: number;
  maxWorkspaceSuggestions: number;
  maxContextBundleChars: number;
  staleStateThresholdMinutes: number;
  suggestionNoiseThreshold: number;
  enableAutomaticProjectMemory: boolean;
  enableAutomaticSuggestions: boolean;
  enableAutomaticProjectModeRefresh: boolean;
  enableFileWatchRefresh: boolean;
  toolTimeoutMs: number;
}>): {
  profile: "conservative" | "balanced" | "aggressive-but-safe";
  refreshDebounceMs: number;
  profileScanEntryLimit: number;
  projectMemorySourceFileLimit: number;
  actionDiscoveryLimit: number;
  maxWorkspaceSuggestions: number;
  maxContextBundleChars: number;
  staleStateThresholdMinutes: number;
  suggestionNoiseThreshold: number;
  enableAutomaticProjectMemory: boolean;
  enableAutomaticSuggestions: boolean;
  enableAutomaticProjectModeRefresh: boolean;
  enableFileWatchRefresh: boolean;
  toolTimeoutMs: number;
} {
  return {
    profile: "balanced",
    refreshDebounceMs: 250,
    profileScanEntryLimit: 160,
    projectMemorySourceFileLimit: 16,
    actionDiscoveryLimit: 8,
    maxWorkspaceSuggestions: 6,
    maxContextBundleChars: 6_000,
    staleStateThresholdMinutes: 60,
    suggestionNoiseThreshold: 3,
    enableAutomaticProjectMemory: true,
    enableAutomaticSuggestions: true,
    enableAutomaticProjectModeRefresh: true,
    enableFileWatchRefresh: true,
    toolTimeoutMs: 30_000,
    ...overrides,
  };
}

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
    likelyActions: ["npm test"],
    generatedAt: "2026-05-11T08:20:00.000Z",
    ...overrides,
  };
}

test("WorkspaceRefreshCoordinator debounces repeated refresh requests and persists suggestions", async () => {
  const sessionStore = new SessionStore();
  const workspaceStore = new WorkspaceStore(new FakeMemento() as never);
  let buildCalls = 0;

  const coordinator = new WorkspaceRefreshCoordinator({
    getWorkspaceRoot: () => "C:/repo",
    sessionStore,
    workspaceStore,
    resolveAutomationSettings: () => createAutomationSettings({ refreshDebounceMs: 20 }),
    now: () => "2026-05-11T08:20:01.000Z",
    buildWorkspaceProfile: async () => {
      buildCalls += 1;
      return { profile: createProfile(), warnings: [] };
    },
    detectWorkspacePhase: () => ({
      phase: "implementation",
      confidence: 0.85,
      reasons: ["Source directories exist."],
      updatedAt: "2026-05-11T08:20:02.000Z",
    }),
    initializeProjectMemorySnapshot: async () => ({
      changed: true,
      warnings: [],
      snapshot: {
        purpose: "Keep project context fresh.",
        stackSummary: "Repo type: node-typescript. Current phase: implementation.",
        conventions: ["Keep edits approval-gated."],
        availableTestCommands: ["npm test"],
        dangerousAreas: ["package.json"],
        currentGoals: ["Run npm test after impactful changes."],
        canonicalSources: ["README.md"],
        summary: "Purpose: Keep project context fresh.",
        summaryFingerprint: "memory-1",
        sectionFingerprints: { stackSummary: "stack-1" },
        updatedAt: "2026-05-11T08:20:03.000Z",
      },
    }),
    deriveWorkspaceSuggestions: () => ([
      {
        id: "continuity:test",
        title: "Run npm test after impactful changes.",
        reason: "Project memory marked this as a current goal.",
        priority: "high",
        source: "continuity",
        createdAt: "2026-05-11T08:20:04.000Z",
      },
    ]),
  });

  coordinator.scheduleRefresh("document saved");
  coordinator.scheduleRefresh("files renamed");
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(buildCalls, 1);
  assert.equal(workspaceStore.getWorkspaceRefreshState().status, "ready");
  assert.equal(workspaceStore.getWorkspaceSuggestions()[0]?.title, "Run npm test after impactful changes.");
  coordinator.dispose();
});

test("WorkspaceRefreshCoordinator records refresh failures while preserving stale state", async () => {
  const sessionStore = new SessionStore();
  const workspaceStore = new WorkspaceStore(new FakeMemento() as never);
  await workspaceStore.saveWorkspaceRefreshState({
    status: "ready",
    stale: false,
    warnings: ["previous warning"],
    lastRefreshAt: "2026-05-11T07:00:00.000Z",
    lastSuccessfulRefreshAt: "2026-05-11T07:00:00.000Z",
  });

  const coordinator = new WorkspaceRefreshCoordinator({
    getWorkspaceRoot: () => "C:/repo",
    sessionStore,
    workspaceStore,
    now: () => "2026-05-11T08:25:01.000Z",
    buildWorkspaceProfile: async () => {
      throw new Error("Workspace bootstrap timed out after 4000 ms.");
    },
  });

  await coordinator.refreshNow("manual");

  const refreshState = workspaceStore.getWorkspaceRefreshState();
  assert.equal(refreshState.status, "error");
  assert.equal(refreshState.stale, true);
  assert.match(refreshState.lastError ?? "", /timed out/i);
  assert.deepEqual(refreshState.warnings, ["previous warning"]);
  coordinator.dispose();
});

test("WorkspaceRefreshCoordinator honors conservative automation limits", async () => {
  const sessionStore = new SessionStore();
  const workspaceStore = new WorkspaceStore(new FakeMemento() as never);
  let projectMemoryCalls = 0;
  const telemetryEvents: Array<{ automationProfile?: string }> = [];

  const coordinator = new WorkspaceRefreshCoordinator({
    getWorkspaceRoot: () => "C:/repo",
    sessionStore,
    workspaceStore,
    now: () => "2026-05-11T08:40:01.000Z",
    resolveAutomationSettings: () => createAutomationSettings({
      profile: "conservative",
      refreshDebounceMs: 20,
      profileScanEntryLimit: 80,
      projectMemorySourceFileLimit: 8,
      actionDiscoveryLimit: 4,
      maxWorkspaceSuggestions: 2,
      maxContextBundleChars: 4_000,
      staleStateThresholdMinutes: 120,
      suggestionNoiseThreshold: 2,
      enableAutomaticProjectMemory: false,
      enableAutomaticSuggestions: false,
      enableAutomaticProjectModeRefresh: false,
      enableFileWatchRefresh: false,
    }),
    buildWorkspaceProfile: async () => ({ profile: createProfile(), warnings: [] }),
    detectWorkspacePhase: () => ({
      phase: "implementation",
      confidence: 0.85,
      reasons: ["Source directories exist."],
      updatedAt: "2026-05-11T08:40:02.000Z",
    }),
    initializeProjectMemorySnapshot: async () => {
      projectMemoryCalls += 1;
      return {
        changed: true,
        warnings: [],
        snapshot: {
          purpose: "unused",
          stackSummary: "unused",
          conventions: [],
          availableTestCommands: [],
          dangerousAreas: [],
          currentGoals: [],
          canonicalSources: [],
          summary: "unused",
          summaryFingerprint: "unused",
          sectionFingerprints: {},
          updatedAt: "2026-05-11T08:40:03.000Z",
        },
      };
    },
    onRefreshTelemetry: (event) => {
      telemetryEvents.push(event);
    },
  });

  await coordinator.refreshNow("manual");

  assert.equal(projectMemoryCalls, 0);
  assert.deepEqual(workspaceStore.getWorkspaceSuggestions(), []);
  assert.match(workspaceStore.getWorkspaceRefreshState().warnings.join("\n"), /disables automatic ranked suggestions/i);
  assert.equal(telemetryEvents[0]?.automationProfile, "conservative");
  coordinator.dispose();
});
