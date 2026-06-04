import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectWorkspacePhase } from "../agent/phaseDetector";
import {
  initializeProjectMemorySnapshot,
  shouldRefreshProjectMemoryForPath,
} from "../agent/projectMemoryInitializer";
import { buildWorkspaceProfile } from "../agent/workspaceBootstrap";

function createTempWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("initializeProjectMemorySnapshot builds a concise summary from docs and profile state", async () => {
  const workspaceRoot = createTempWorkspace("agent-platform-memory-");
  try {
    mkdirSync(join(workspaceRoot, "docs"), { recursive: true });
    mkdirSync(join(workspaceRoot, ".github"), { recursive: true });
    writeFileSync(join(workspaceRoot, "README.md"), [
      "# Sample Project",
      "",
      "A VS Code extension that keeps project context fresh across sessions.",
      "",
      "## Goals",
      "- Keep edits approval-gated.",
    ].join("\n"));
    writeFileSync(join(workspaceRoot, ".github", "copilot-instructions.md"), [
      "# Instructions",
      "",
      "- Keep edits approval-gated.",
      "- Prefer validating changes with npm test.",
    ].join("\n"));
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({
      name: "memory-fixture",
      scripts: { test: "node --test", compile: "tsc -p ./" },
      devDependencies: { typescript: "^5.8.3", "@types/vscode": "^1.99.0" },
      engines: { vscode: "^1.99.0" },
    }, null, 2));
    writeFileSync(join(workspaceRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "commonjs" } }));
    mkdirSync(join(workspaceRoot, "src"), { recursive: true });

    const profileResult = await buildWorkspaceProfile(workspaceRoot);
    const phase = detectWorkspacePhase(profileResult.profile);
    const result = await initializeProjectMemorySnapshot({
      workspaceRoot,
      profile: profileResult.profile,
      phase,
    });

    assert.equal(result.changed, true);
    assert.match(result.snapshot.purpose ?? "", /keeps project context fresh/i);
    assert.match(result.snapshot.stackSummary, /Repo type: node-typescript/i);
    assert.ok(result.snapshot.conventions.some((entry) => /approval-gated/i.test(entry)));
    assert.ok(result.snapshot.availableTestCommands.includes("npm test"));
    assert.ok(result.snapshot.currentGoals.length > 0);
    assert.ok(result.snapshot.summary.includes("Purpose:"));
    assert.ok(result.snapshot.summary.includes("Sources:"));
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("initializeProjectMemorySnapshot reuses unchanged sections and reports no change when fingerprints match", async () => {
  const workspaceRoot = createTempWorkspace("agent-platform-memory-dedupe-");
  try {
    writeFileSync(join(workspaceRoot, "README.md"), "# Sample\n\nA docs-first workspace.\n");
    mkdirSync(join(workspaceRoot, "docs"), { recursive: true });
    writeFileSync(join(workspaceRoot, "docs", "architecture.md"), "# Architecture\n\nKeep edits approval-gated.\n");

    const profileResult = await buildWorkspaceProfile(workspaceRoot);
    const phase = detectWorkspacePhase(profileResult.profile);
    const first = await initializeProjectMemorySnapshot({
      workspaceRoot,
      profile: profileResult.profile,
      phase,
    });
    const second = await initializeProjectMemorySnapshot({
      workspaceRoot,
      profile: profileResult.profile,
      phase,
      previousSnapshot: first.snapshot,
    });

    assert.equal(second.changed, false);
    assert.equal(second.snapshot.updatedAt, first.snapshot.updatedAt);
    assert.equal(second.snapshot.summaryFingerprint, first.snapshot.summaryFingerprint);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("shouldRefreshProjectMemoryForPath targets meaningful docs and workspace files", () => {
  const workspaceRoot = "C:/repo";

  assert.equal(shouldRefreshProjectMemoryForPath(workspaceRoot, "C:/repo/README.md"), true);
  assert.equal(shouldRefreshProjectMemoryForPath(workspaceRoot, "C:/repo/docs/architecture.md"), true);
  assert.equal(shouldRefreshProjectMemoryForPath(workspaceRoot, "C:/repo/src/service.ts"), true);
  assert.equal(shouldRefreshProjectMemoryForPath(workspaceRoot, "C:/repo/media/icon.png"), false);
  assert.equal(shouldRefreshProjectMemoryForPath(workspaceRoot, "C:/other/file.md"), false);
});
