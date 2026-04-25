import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { runTests } from "@vscode/test-electron";

function pathSeparator(): string {
  return process.platform === "win32" ? ";" : ":";
}

function detectPreferredPython(repoRoot: string): string | undefined {
  const candidates = process.platform === "win32"
    ? [join(repoRoot, ".venv", "Scripts", "python.exe")]
    : [join(repoRoot, ".venv", "bin", "python")];

  return candidates.find((candidate) => existsSync(candidate));
}

function prepareMutationWorkspace(extensionDevelopmentPath: string): { workspacePath: string; userDataDir: string } {
  const repoRoot = resolve(extensionDevelopmentPath, "..");
  const fixtureRoot = resolve(extensionDevelopmentPath, "src", "test", "fixtures", "mutation-workspace");
  const scratchParent = resolve(extensionDevelopmentPath, ".tmp");
  const workspacePath = join(scratchParent, `mutation-e2e-${Date.now()}`);
  const userDataDir = join(scratchParent, `mutation-e2e-user-data-${Date.now()}`);

  mkdirSync(scratchParent, { recursive: true });
  cpSync(fixtureRoot, workspacePath, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });

  const repoSrc = join(repoRoot, "src");
  process.env.PYTHONPATH = [repoSrc, process.env.PYTHONPATH ?? ""]
    .filter((part) => part.length > 0)
    .join(pathSeparator());

  const settingsPath = join(workspacePath, ".vscode", "settings.json");
  const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  const preferredPython = detectPreferredPython(repoRoot);
  if (preferredPython) {
    currentSettings["agentPlatform.pythonPath"] = preferredPython;
  }
  writeFileSync(settingsPath, `${JSON.stringify(currentSettings, null, 2)}\n`, "utf-8");

  return { workspacePath, userDataDir };
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "..", "..");
  const extensionTestsPath = resolve(__dirname, "extensionHost", "mutationE2E.js");
  const { workspacePath, userDataDir } = prepareMutationWorkspace(extensionDevelopmentPath);

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, "--disable-extensions", "--user-data-dir", userDataDir],
  });
}

void main().catch((error) => {
  console.error("Failed to run Token Savior mutation E2E tests.", error);
  process.exit(1);
});
