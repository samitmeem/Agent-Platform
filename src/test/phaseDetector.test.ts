import test from "node:test";
import assert from "node:assert/strict";

import { detectWorkspacePhase } from "../agent/phaseDetector";
import type { WorkspaceProfile } from "../state/workspaceAnalysis";

function createProfile(overrides: Partial<WorkspaceProfile> = {}): WorkspaceProfile {
  return {
    workspaceRoot: "c:/workspace",
    repoType: "unknown",
    languages: [],
    frameworks: [],
    packageManagers: [],
    testFrameworks: [],
    availableTestCommands: [],
    hasDocker: false,
    hasCi: false,
    hasEnvFiles: false,
    hasInstructionDocs: false,
    hasChangelog: false,
    sourceDirectories: [],
    testDirectories: [],
    riskAreas: [],
    likelyActions: [],
    generatedAt: "2026-05-11T00:00:00.000Z",
    ...overrides,
  };
}

test("detectWorkspacePhase returns idea-spec for docs-first repos", () => {
  const result = detectWorkspacePhase(createProfile({
    repoType: "docs-only",
    hasInstructionDocs: true,
  }));

  assert.equal(result.phase, "idea-spec");
  assert.ok(result.confidence >= 0.9);
  assert.match(result.reasons.join("\n"), /instruction|source directories/i);
});

test("detectWorkspacePhase returns scaffolding when source exists without tests or CI", () => {
  const result = detectWorkspacePhase(createProfile({
    repoType: "node-typescript",
    languages: ["TypeScript"],
    sourceDirectories: ["src"],
  }));

  assert.equal(result.phase, "scaffolding");
  assert.ok(result.confidence >= 0.7);
});

test("detectWorkspacePhase returns maintenance for mature repos with release workflows", () => {
  const result = detectWorkspacePhase(createProfile({
    repoType: "node-typescript",
    languages: ["TypeScript"],
    hasInstructionDocs: true,
    hasCi: true,
    sourceDirectories: ["src"],
    testDirectories: ["src/test"],
    testFrameworks: ["Node Test Runner"],
    availableTestCommands: ["npm test"],
    likelyActions: ["npm test", "npm run package"],
  }));

  assert.equal(result.phase, "maintenance");
  assert.ok(result.confidence >= 0.75);
});
