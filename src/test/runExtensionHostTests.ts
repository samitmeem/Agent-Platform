import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "..", "..");
  const extensionTestsPath = resolve(__dirname, "extensionHost", "run.js");
  const workspacePath = extensionDevelopmentPath;
  const userDataDir = join(extensionDevelopmentPath, ".tmp", `extension-host-user-data-${Date.now()}`);

  mkdirSync(userDataDir, { recursive: true });

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [workspacePath, "--disable-extensions", "--user-data-dir", userDataDir],
  });
}

void main().catch((error) => {
  console.error("Failed to run Agent-Platform extension-host tests.", error);
  process.exit(1);
});
