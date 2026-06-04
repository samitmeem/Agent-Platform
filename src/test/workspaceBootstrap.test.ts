import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildWorkspaceProfile } from "../agent/workspaceBootstrap";

function createTempWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("buildWorkspaceProfile classifies docs-only repos safely", async () => {
  const workspaceRoot = createTempWorkspace("agent-platform-docs-");
  try {
    writeFileSync(join(workspaceRoot, "README.md"), "# Docs first\n\nArchitecture decisions.");
    mkdirSync(join(workspaceRoot, "docs"), { recursive: true });
    writeFileSync(join(workspaceRoot, "docs", "architecture.md"), "# Architecture\n");

    const result = await buildWorkspaceProfile(workspaceRoot);

    assert.equal(result.profile.repoType, "docs-only");
    assert.equal(result.profile.hasInstructionDocs, true);
    assert.deepEqual(result.profile.sourceDirectories, []);
    assert.match(result.warnings.join("\n"), /docs-first/i);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("buildWorkspaceProfile detects a TypeScript workspace with tests and CI", async () => {
  const workspaceRoot = createTempWorkspace("agent-platform-ts-");
  try {
    mkdirSync(join(workspaceRoot, "src", "test"), { recursive: true });
    mkdirSync(join(workspaceRoot, ".github", "workflows"), { recursive: true });
    writeFileSync(join(workspaceRoot, "src", "extension.ts"), "export const ready = true;\n");
    writeFileSync(join(workspaceRoot, ".github", "workflows", "ci.yml"), "name: ci\n");
    writeFileSync(join(workspaceRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "commonjs" } }));
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({
      name: "phase-one-fixture",
      engines: { vscode: "^1.99.0" },
      scripts: {
        test: "node --test",
        "test:extension-host": "node ./out/test/runExtensionHostTests.js",
        compile: "tsc -p ./",
      },
      devDependencies: {
        typescript: "^5.8.3",
        "@types/vscode": "^1.99.0",
        "@vscode/test-electron": "^2.5.2",
      },
    }, null, 2));

    const result = await buildWorkspaceProfile(workspaceRoot);

    assert.equal(result.profile.repoType, "node-typescript");
    assert.ok(result.profile.languages.includes("TypeScript"));
    assert.ok(result.profile.frameworks.includes("VS Code Extension"));
    assert.ok(result.profile.packageManagers.includes("npm"));
    assert.ok(result.profile.testFrameworks.includes("Node Test Runner"));
    assert.ok(result.profile.testFrameworks.includes("VS Code Extension Host"));
    assert.ok(result.profile.availableTestCommands.includes("npm test"));
    assert.ok(result.profile.availableTestCommands.includes("npm run test:extension-host"));
    assert.equal(result.profile.hasCi, true);
    assert.ok(result.profile.testDirectories.includes("src/test"));
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("buildWorkspaceProfile discovers likely actions from workspace automation files", async () => {
  const workspaceRoot = createTempWorkspace("agent-platform-actions-");
  try {
    mkdirSync(join(workspaceRoot, "src"), { recursive: true });
    writeFileSync(join(workspaceRoot, "src", "main.py"), "print('ready')\n");
    writeFileSync(join(workspaceRoot, "README.md"), [
      "# Project",
      "",
      "- pytest",
      "- docker compose up api",
      "- make lint",
    ].join("\n"));
    writeFileSync(join(workspaceRoot, "Makefile"), [
      "test:",
      "\tpytest",
      "lint:",
      "\truff check .",
    ].join("\n"));
    writeFileSync(join(workspaceRoot, "requirements.txt"), [
      "pytest==8.0.0",
      "ruff==0.6.0",
    ].join("\n"));
    writeFileSync(join(workspaceRoot, "docker-compose.yml"), [
      "services:",
      "  api:",
      "    image: python:3.12",
      "  worker:",
      "    image: python:3.12",
    ].join("\n"));

    const result = await buildWorkspaceProfile(workspaceRoot);

    assert.ok(result.profile.likelyActions.includes("pytest"));
    assert.ok(result.profile.likelyActions.includes("make test"));
    assert.ok(result.profile.likelyActions.includes("docker compose up"));
    assert.ok(result.profile.likelyActions.includes("docker compose up api"));
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
