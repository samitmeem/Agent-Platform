import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSpawnOptions,
  detectWorkspacePythonPath,
  resolvePythonCommand,
} from "../backend/processManager";

test("detectWorkspacePythonPath finds local venv interpreter for requested platform", () => {
  const root = mkdtempSync(join(tmpdir(), "ts-vscode-ext-"));
  const pythonPath = join(root, ".venv", "Scripts", "python.exe");
  mkdirSync(join(root, ".venv", "Scripts"), { recursive: true });
  writeFileSync(pythonPath, "");

  const detected = detectWorkspacePythonPath(root, "win32");

  assert.equal(detected, pythonPath);
});

test("resolvePythonCommand prefers configured path", () => {
  const command = resolvePythonCommand({
    workspaceRoot: "C:/repo",
    configuredPythonPath: "C:/custom/python.exe",
  });

  assert.equal(command, "C:/custom/python.exe");
});

test("buildSpawnOptions injects workspace src into PYTHONPATH", () => {
  const root = mkdtempSync(join(tmpdir(), "ts-vscode-ext-"));

  const result = buildSpawnOptions({
    workspaceRoot: root,
    configuredPythonPath: "python",
    env: { PYTHONPATH: "existing-path" },
  });

  assert.equal(result.command, "python");
  assert.deepEqual(result.args, ["-m", "token_savior.service_api.server"]);
  assert.match(result.spawnOptions.env?.PYTHONPATH ?? "", /existing-path/);
  assert.match(result.spawnOptions.env?.PYTHONPATH ?? "", /src/);
  assert.equal(result.spawnOptions.env?.PROJECT_ROOT, root);
  assert.equal(result.spawnOptions.env?.WORKSPACE_ROOTS, root);
});