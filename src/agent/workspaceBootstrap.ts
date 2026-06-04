import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

import type { WorkspaceProfile } from "../state/workspaceAnalysis";

interface PackageJsonLike {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  engines?: Record<string, unknown>;
}

export interface WorkspaceBootstrapResult {
  profile: WorkspaceProfile;
  warnings: string[];
}

export interface WorkspaceBootstrapOptions {
  maxRootEntries?: number;
  maxLikelyActions?: number;
}

const SOURCE_DIRECTORY_CANDIDATES = ["src", "app", "lib", "server", "backend", "frontend", "packages"];
const TEST_DIRECTORY_CANDIDATES = ["test", "tests", "__tests__", "spec", "specs"];
const INSTRUCTION_FILE_CANDIDATES = [
  "README.md",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "SPEC.md",
  "SPECIFICATION.md",
  "DESIGN.md",
  "CONTRIBUTING.md",
  join(".github", "copilot-instructions.md"),
  join(".github", "instructions.md"),
];

const ROOT_ENTRY_PRIORITIES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "readme.md",
  "docs",
  ".github",
  "src",
  "test",
  "tests",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "makefile",
  ".env",
  "changelog.md",
];

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.trim().length > 0))];
}

function prioritizeRootEntries(entries: readonly Dirent[]): Dirent[] {
  const withPriority = entries.map((entry) => {
    const normalized = entry.name.toLowerCase();
    const priorityIndex = ROOT_ENTRY_PRIORITIES.findIndex((candidate) => candidate === normalized);
    return {
      entry,
      priority: priorityIndex >= 0 ? ROOT_ENTRY_PRIORITIES.length - priorityIndex : 0,
    };
  });

  withPriority.sort((left, right) => right.priority - left.priority || left.entry.name.localeCompare(right.entry.name));
  return withPriority.map(({ entry }) => entry);
}

function pathExists(path: string): boolean {
  return existsSync(path);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeReadDirectory(path: string): Dirent[] {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}

function safeReadPackageJson(workspaceRoot: string): PackageJsonLike | undefined {
  const raw = safeReadText(join(workspaceRoot, "package.json"));
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as PackageJsonLike;
  } catch {
    return undefined;
  }
}

function collectDependencyNames(packageJson: PackageJsonLike | undefined): Set<string> {
  const sections = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
  ];
  const names: string[] = [];
  for (const section of sections) {
    if (!section) {
      continue;
    }

    names.push(...Object.keys(section));
  }

  return new Set(names.map((name) => name.toLowerCase()));
}

function normalizeScripts(packageJson: PackageJsonLike | undefined): Record<string, string> {
  const scripts: Record<string, string> = {};
  const rawScripts = packageJson?.scripts;
  if (!rawScripts) {
    return scripts;
  }

  for (const [name, value] of Object.entries(rawScripts)) {
    if (typeof value === "string" && value.trim().length > 0) {
      scripts[name] = value.trim();
    }
  }

  return scripts;
}

function resolveNodePackageManager(fileNamesLower: Set<string>): string | undefined {
  if (!fileNamesLower.has("package.json")) {
    return undefined;
  }

  if (fileNamesLower.has("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (fileNamesLower.has("yarn.lock")) {
    return "yarn";
  }
  if (fileNamesLower.has("bun.lockb") || fileNamesLower.has("bun.lock")) {
    return "bun";
  }
  return "npm";
}

function toNodeScriptCommand(packageManager: string, scriptName: string): string {
  switch (packageManager) {
    case "npm":
      return scriptName === "test" ? "npm test" : `npm run ${scriptName}`;
    case "bun":
      return scriptName === "test" ? "bun test" : `bun run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "pnpm":
      return `pnpm ${scriptName}`;
    default:
      return `${packageManager} ${scriptName}`;
  }
}

function toInstallCommand(packageManager: string): string {
  switch (packageManager) {
    case "yarn":
      return "yarn install";
    case "pnpm":
      return "pnpm install";
    case "bun":
      return "bun install";
    default:
      return "npm install";
  }
}

function prioritizeActions(actions: readonly string[], priorityPatterns: readonly RegExp[]): string[] {
  const scored = actions.map((action) => ({
    action,
    score: priorityPatterns.reduce((score, pattern, index) => score + (pattern.test(action) ? priorityPatterns.length - index : 0), 0),
  }));

  scored.sort((left, right) => right.score - left.score || left.action.localeCompare(right.action));
  return scored.map(({ action }) => action);
}

function collectMakeActions(makefileText: string | undefined): string[] {
  if (!makefileText) {
    return [];
  }

  const targets = [...makefileText.matchAll(/^([A-Za-z][A-Za-z0-9._-]+):(?:\s|$)/gm)]
    .map((match) => match[1])
    .filter((target) => !target.startsWith("."));
  return prioritizeActions(uniqueStrings(targets.map((target) => `make ${target}`)), [
    /make (test|check|lint|build|run|dev)/i,
  ]).slice(0, 4);
}

function collectPythonActions(pyprojectText: string | undefined, requirementsText: string | undefined): string[] {
  const combined = [pyprojectText, requirementsText].filter(Boolean).join("\n").toLowerCase();
  if (!combined) {
    return [];
  }

  const actions: string[] = [];
  if (/pytest/.test(combined)) {
    actions.push("pytest");
  }
  if (/\bruff\b/.test(combined)) {
    actions.push("ruff check .");
  }
  if (/\bblack\b/.test(combined)) {
    actions.push("black .");
  }
  if (/\bmypy\b/.test(combined)) {
    actions.push("mypy .");
  }
  if (/uvicorn/.test(combined)) {
    actions.push("uvicorn app:app --reload");
  }

  return prioritizeActions(uniqueStrings(actions), [
    /pytest/i,
    /ruff|black|mypy/i,
    /uvicorn/i,
  ]).slice(0, 4);
}

function collectComposeActions(composeText: string | undefined): string[] {
  if (!composeText) {
    return [];
  }

  const actions = ["docker compose up", "docker compose down"];
  const afterServices = composeText.split(/^\s*services:\s*$/im)[1];
  if (afterServices) {
    const services = [...afterServices.matchAll(/^\s{2}([A-Za-z0-9._-]+):\s*$/gm)]
      .map((match) => match[1])
      .slice(0, 2);
    actions.push(...services.map((service) => `docker compose up ${service}`));
  }

  return uniqueStrings(actions).slice(0, 4);
}

function collectReadmeCommands(readmeText: string | undefined): string[] {
  if (!readmeText) {
    return [];
  }

  const commands: string[] = [];
  for (const rawLine of readmeText.split(/\r?\n/)) {
    const normalized = rawLine
      .trim()
      .replace(/^[-*]\s+/, "")
      .replace(/^`([^`]+)`$/, "$1")
      .replace(/\s+#.*$/, "")
      .trim();
    if (!/^(npm|pnpm|yarn|bun|pytest|python\s+-m\s+pytest|make|docker compose)\b/i.test(normalized)) {
      continue;
    }

    commands.push(normalized);
  }

  return prioritizeActions(uniqueStrings(commands), [
    /test|check|lint|build/i,
    /docker compose/i,
  ]).slice(0, 6);
}

function detectSourceDirectories(workspaceRoot: string, directoryNamesLower: Set<string>): string[] {
  return SOURCE_DIRECTORY_CANDIDATES.filter((candidate) => directoryNamesLower.has(candidate) && isDirectory(join(workspaceRoot, candidate)));
}

function detectTestDirectories(workspaceRoot: string, sourceDirectories: readonly string[], directoryNamesLower: Set<string>): string[] {
  const discovered = TEST_DIRECTORY_CANDIDATES
    .filter((candidate) => directoryNamesLower.has(candidate) && isDirectory(join(workspaceRoot, candidate)));

  for (const sourceDirectory of sourceDirectories) {
    for (const candidate of TEST_DIRECTORY_CANDIDATES) {
      const nested = join(workspaceRoot, sourceDirectory, candidate);
      if (isDirectory(nested)) {
        discovered.push(`${sourceDirectory}/${candidate}`);
      }
    }
  }

  return uniqueStrings(discovered);
}

function detectInstructionDocs(workspaceRoot: string, entries: readonly Dirent[]): boolean {
  const hasTopLevelMarkdown = entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"));
  if (hasTopLevelMarkdown || isDirectory(join(workspaceRoot, "docs"))) {
    return true;
  }

  return INSTRUCTION_FILE_CANDIDATES.some((relativePath) => pathExists(join(workspaceRoot, relativePath)));
}

function detectHasDocker(entries: readonly Dirent[]): boolean {
  return entries.some((entry) => {
    const lower = entry.name.toLowerCase();
    return lower === "dockerfile"
      || lower.startsWith("dockerfile.")
      || lower === "docker-compose.yml"
      || lower === "docker-compose.yaml"
      || lower === "compose.yml"
      || lower === "compose.yaml";
  });
}

function detectHasCi(workspaceRoot: string): boolean {
  const workflowsPath = join(workspaceRoot, ".github", "workflows");
  return isDirectory(workflowsPath) && safeReadDirectory(workflowsPath).some((entry) => entry.isFile());
}

function detectHasEnvFiles(entries: readonly Dirent[]): boolean {
  return entries.some((entry) => entry.isFile() && entry.name.toLowerCase().startsWith(".env"));
}

function detectLikelyActions(
  packageManager: string | undefined,
  scripts: Record<string, string>,
  repoType: WorkspaceProfile["repoType"],
  hasTests: boolean,
  extraActions: readonly string[] = [],
  maxActions = 12,
): string[] {
  const actions: string[] = [];

  if (packageManager) {
    actions.push(toInstallCommand(packageManager));
    for (const scriptName of ["compile", "build", "watch", "dev", "start", "lint", "check", "format", "test", "test:extension-host", "test:mutation-e2e", "package"]) {
      if (scripts[scriptName]) {
        actions.push(toNodeScriptCommand(packageManager, scriptName));
      }
    }
  }

  actions.push(...extraActions);

  if (repoType === "docs-only") {
    actions.push("Create an initial source scaffold");
    actions.push("Turn specs into implementation milestones");
  }

  if (!hasTests && repoType !== "docs-only" && repoType !== "unknown") {
    actions.push("Add a test harness before wider implementation");
  }

  return uniqueStrings(actions).slice(0, Math.max(2, maxActions));
}

export async function buildWorkspaceProfile(workspaceRoot: string, options?: WorkspaceBootstrapOptions): Promise<WorkspaceBootstrapResult> {
  const maxRootEntries = Math.max(20, options?.maxRootEntries ?? 160);
  const allEntries = prioritizeRootEntries(safeReadDirectory(workspaceRoot));
  const entries = allEntries.slice(0, maxRootEntries);
  const fileNamesLower = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase()));
  const directoryNamesLower = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase()));
  const packageJson = safeReadPackageJson(workspaceRoot);
  const dependencyNames = collectDependencyNames(packageJson);
  const scripts = normalizeScripts(packageJson);
  const packageManager = resolveNodePackageManager(fileNamesLower);
  const readmeText = safeReadText(join(workspaceRoot, "README.md"));
  const makefileText = safeReadText(join(workspaceRoot, "Makefile")) ?? safeReadText(join(workspaceRoot, "makefile"));
  const composeText = safeReadText(join(workspaceRoot, "docker-compose.yml"))
    ?? safeReadText(join(workspaceRoot, "docker-compose.yaml"))
    ?? safeReadText(join(workspaceRoot, "compose.yml"))
    ?? safeReadText(join(workspaceRoot, "compose.yaml"));
  const sourceDirectories = detectSourceDirectories(workspaceRoot, directoryNamesLower);
  const testDirectories = detectTestDirectories(workspaceRoot, sourceDirectories, directoryNamesLower);
  const hasInstructionDocs = detectInstructionDocs(workspaceRoot, entries);
  const hasDocker = detectHasDocker(entries);
  const hasCi = detectHasCi(workspaceRoot);
  const hasEnvFiles = detectHasEnvFiles(entries);
  const hasChangelog = fileNamesLower.has("changelog.md");

  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const packageManagers = new Set<string>();
  const testFrameworks = new Set<string>();
  const availableTestCommands: string[] = [];
  const riskAreas: string[] = [];

  if (fileNamesLower.has("tsconfig.json") || dependencyNames.has("typescript")) {
    languages.add("TypeScript");
  } else if (fileNamesLower.has("package.json")) {
    languages.add("JavaScript");
  }

  const pyprojectText = safeReadText(join(workspaceRoot, "pyproject.toml"));
  const requirementsText = safeReadText(join(workspaceRoot, "requirements.txt"));
  const pythonSignals = [pyprojectText, requirementsText, safeReadText(join(workspaceRoot, "setup.py"))].filter(Boolean).join("\n");
  if (pythonSignals.length > 0) {
    languages.add("Python");
  }

  const pubspecText = safeReadText(join(workspaceRoot, "pubspec.yaml"));
  if (pubspecText) {
    languages.add("Dart");
  }

  if (packageManager) {
    packageManagers.add(packageManager);
  }
  if (pyprojectText || requirementsText) {
    packageManagers.add(fileNamesLower.has("poetry.lock") ? "poetry" : "pip");
  }
  if (pubspecText) {
    packageManagers.add("pub");
  }

  if (typeof packageJson?.engines?.vscode === "string" || dependencyNames.has("@types/vscode")) {
    frameworks.add("VS Code Extension");
  }
  if (dependencyNames.has("react")) {
    frameworks.add("React");
  }
  if (dependencyNames.has("next")) {
    frameworks.add("Next.js");
  }
  if (/\bfastapi\b/i.test(pythonSignals)) {
    frameworks.add("FastAPI");
  }
  if (/^\s*flutter\s*:/im.test(pubspecText ?? "")) {
    frameworks.add("Flutter");
  }

  if (dependencyNames.has("vitest") || Object.values(scripts).some((script) => /\bvitest\b/i.test(script))) {
    testFrameworks.add("Vitest");
  }
  if (dependencyNames.has("jest") || Object.values(scripts).some((script) => /\bjest\b/i.test(script))) {
    testFrameworks.add("Jest");
  }
  if (dependencyNames.has("mocha") || Object.values(scripts).some((script) => /\bmocha\b/i.test(script))) {
    testFrameworks.add("Mocha");
  }
  if (dependencyNames.has("@playwright/test") || Object.values(scripts).some((script) => /playwright/i.test(script))) {
    testFrameworks.add("Playwright");
  }
  if (Object.values(scripts).some((script) => /node\s+--test/i.test(script))) {
    testFrameworks.add("Node Test Runner");
  }
  if (dependencyNames.has("@vscode/test-electron") || Object.keys(scripts).some((name) => /extension-host/i.test(name))) {
    testFrameworks.add("VS Code Extension Host");
  }
  if (/\bpytest\b/i.test(pythonSignals)) {
    testFrameworks.add("Pytest");
    availableTestCommands.push("pytest");
  }
  if (/flutter_test/i.test(pubspecText ?? "")) {
    testFrameworks.add("Flutter Test");
    availableTestCommands.push("flutter test");
  }

  if (packageManager) {
    for (const [name, script] of Object.entries(scripts)) {
      if (/^test($|:)/i.test(name) || /(jest|vitest|mocha|playwright|node\s+--test)/i.test(script)) {
        availableTestCommands.push(toNodeScriptCommand(packageManager, name));
      }
    }
  }

  if (fileNamesLower.has("package.json")) {
    riskAreas.push("package.json");
  }
  if (fileNamesLower.has("tsconfig.json")) {
    riskAreas.push("tsconfig.json");
  }
  if (pyprojectText || requirementsText) {
    riskAreas.push(pyprojectText ? "pyproject.toml" : "requirements.txt");
  }
  if (hasCi) {
    riskAreas.push(".github/workflows");
  }
  if (hasDocker) {
    riskAreas.push("Docker/deployment files");
  }
  if (pathExists(join(workspaceRoot, "src", "extension.ts"))) {
    riskAreas.push("src/extension.ts");
  }

  const hasSource = sourceDirectories.length > 0;
  const detectedLanguages = uniqueStrings(languages);
  let repoType: WorkspaceProfile["repoType"] = "unknown";
  const hasNode = fileNamesLower.has("package.json") || detectedLanguages.includes("TypeScript") || detectedLanguages.includes("JavaScript");
  const hasPython = detectedLanguages.includes("Python");
  const hasDart = detectedLanguages.includes("Dart");

  if (!hasNode && !hasPython && !hasDart && !hasSource && hasInstructionDocs) {
    repoType = "docs-only";
  } else if ((hasNode ? 1 : 0) + (hasPython ? 1 : 0) + (hasDart ? 1 : 0) > 1) {
    repoType = "mixed";
  } else if (hasNode && detectedLanguages.includes("TypeScript")) {
    repoType = "node-typescript";
  } else if (hasNode) {
    repoType = "node-javascript";
  } else if (hasPython) {
    repoType = "python";
  } else if (hasDart) {
    repoType = "dart-flutter";
  }

  const discoveredActions = uniqueStrings([
    ...collectMakeActions(makefileText),
    ...collectPythonActions(pyprojectText, requirementsText),
    ...collectComposeActions(composeText),
    ...collectReadmeCommands(readmeText),
  ]);

  const likelyActions = detectLikelyActions(
    packageManager,
    scripts,
    repoType,
    testDirectories.length > 0 || testFrameworks.size > 0 || availableTestCommands.length > 0,
    discoveredActions,
    options?.maxLikelyActions,
  );

  const warnings: string[] = [];
  if (allEntries.length > entries.length) {
    warnings.push(`Workspace profile scan was limited to ${entries.length} prioritized top-level entries.`);
  }
  if (repoType === "docs-only") {
    warnings.push("Workspace appears docs-first; source directories were not detected yet.");
  }
  if (repoType === "unknown") {
    warnings.push("No common stack markers were detected; the workspace is classified as unknown for safety.");
  }
  if (!hasCi && hasSource) {
    warnings.push("CI workflow markers were not detected.");
  }

  return {
    profile: {
      workspaceRoot,
      repoType,
      languages: detectedLanguages,
      frameworks: uniqueStrings(frameworks),
      packageManagers: uniqueStrings(packageManagers),
      testFrameworks: uniqueStrings(testFrameworks),
      availableTestCommands: uniqueStrings(availableTestCommands),
      hasDocker,
      hasCi,
      hasEnvFiles,
      hasInstructionDocs,
      hasChangelog,
      sourceDirectories,
      testDirectories,
      riskAreas: uniqueStrings(riskAreas),
      likelyActions,
      generatedAt: new Date().toISOString(),
    },
    warnings,
  };
}
