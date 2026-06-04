import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

import type {
  WorkspacePhaseAssessment,
  WorkspaceProfile,
  WorkspaceProjectMemory,
  WorkspaceProjectMemorySectionKey,
} from "../state/workspaceAnalysis";

export interface ProjectMemoryInitializerInput {
  workspaceRoot: string;
  profile: WorkspaceProfile;
  phase: WorkspacePhaseAssessment;
  previousSnapshot?: WorkspaceProjectMemory;
  maxSourceFiles?: number;
}

export interface ProjectMemoryInitializerResult {
  snapshot: WorkspaceProjectMemory;
  changed: boolean;
  warnings: string[];
}

const ROOT_DOCUMENT_CANDIDATES = [
  "README.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "docs/README.md",
  "docs/project-overview.md",
  ".github/copilot-instructions.md",
  ".github/instructions.md",
];

const ROOT_CONFIG_CANDIDATES = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".env",
  ".env.example",
  ".env.sample",
];

const CONVENTION_KEYWORDS = /(approval|approve|typed|type|tests?|validation|read-only|async|workspace|pep|airbnb|minimal|trust|destructive|command|policy|python|docker)/i;
const PATHS_TRIGGERING_REFRESH = new Set([
  "readme.md",
  "agents.md",
  "changelog.md",
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".github/copilot-instructions.md",
  ".github/instructions.md",
]);

interface MemorySourceFile {
  relativePath: string;
  content: string;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter((value) => value.length > 0))];
}

function compact(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function createFingerprint(value: unknown): string {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha1").update(serialized).digest("hex");
}

function safeReadText(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function safeReadDirectory(filePath: string): Dirent[] {
  try {
    return readdirSync(filePath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function collectDirectoryMarkdownFiles(workspaceRoot: string, relativeDirectory: string): MemorySourceFile[] {
  const absoluteDirectory = join(workspaceRoot, relativeDirectory);
  if (!isDirectory(absoluteDirectory)) {
    return [];
  }

  const collected: MemorySourceFile[] = [];
  for (const entry of safeReadDirectory(absoluteDirectory)) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      const relativePath = `${relativeDirectory}/${entry.name}`.replace(/\\/g, "/");
      const content = safeReadText(join(absoluteDirectory, entry.name));
      if (content) {
        collected.push({ relativePath, content });
      }
      continue;
    }

    if (entry.isDirectory()) {
      const nestedDirectory = join(absoluteDirectory, entry.name);
      for (const nestedEntry of safeReadDirectory(nestedDirectory)) {
        if (!nestedEntry.isFile() || !nestedEntry.name.toLowerCase().endsWith(".md")) {
          continue;
        }

        const relativePath = `${relativeDirectory}/${entry.name}/${nestedEntry.name}`.replace(/\\/g, "/");
        const content = safeReadText(join(nestedDirectory, nestedEntry.name));
        if (content) {
          collected.push({ relativePath, content });
        }
      }
    }
  }

  return collected;
}

function collectCanonicalSources(workspaceRoot: string, maxSourceFiles = 16): { sources: MemorySourceFile[]; truncatedCount: number } {
  const sources: MemorySourceFile[] = [];
  for (const relativePath of ROOT_DOCUMENT_CANDIDATES) {
    const content = safeReadText(join(workspaceRoot, relativePath));
    if (content) {
      sources.push({ relativePath: relativePath.replace(/\\/g, "/"), content });
    }
  }

  for (const relativePath of ROOT_CONFIG_CANDIDATES) {
    const content = safeReadText(join(workspaceRoot, relativePath));
    if (content) {
      sources.push({ relativePath: relativePath.replace(/\\/g, "/"), content });
    }
  }

  sources.push(...collectDirectoryMarkdownFiles(workspaceRoot, "docs"));
  const limitedSources = sources.slice(0, Math.max(4, maxSourceFiles));
  return {
    sources: limitedSources,
    truncatedCount: Math.max(0, sources.length - limitedSources.length),
  };
}

function removeCodeBlocks(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, " ");
}

function extractFirstParagraph(markdown: string): string | undefined {
  const lines = removeCodeBlocks(markdown).split(/\r?\n/);
  const paragraph: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }

    if (/^#/.test(line)) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (/^>/.test(line)) {
      continue;
    }
    if (/^(-|\*|\d+\.)\s+/.test(line) && paragraph.length === 0) {
      continue;
    }

    paragraph.push(line);
  }

  return paragraph.length > 0 ? compact(paragraph.join(" "), 220) : undefined;
}

function selectPurpose(sources: readonly MemorySourceFile[]): string | undefined {
  const preferred = [
    ...sources.filter((source) => source.relativePath.toLowerCase() === "readme.md"),
    ...sources.filter((source) => /project-overview|overview|architecture|spec/i.test(source.relativePath)),
    ...sources,
  ];

  for (const source of preferred) {
    const paragraph = extractFirstParagraph(source.content);
    if (paragraph) {
      return paragraph;
    }
  }

  return undefined;
}

function extractConventionLines(sources: readonly MemorySourceFile[]): string[] {
  const extracted: string[] = [];

  for (const source of sources) {
    const isInstructionSource = /copilot-instructions|agents|instructions|contributing|readme/i.test(source.relativePath);
    if (!isInstructionSource) {
      continue;
    }

    for (const rawLine of source.content.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed || /^#/.test(trimmed) || /^```/.test(trimmed)) {
        continue;
      }

      const normalized = trimmed.replace(/^(-|\*|\d+\.)\s+/, "").trim();
      if (normalized.length < 20 || normalized.length > 160) {
        continue;
      }
      if (!CONVENTION_KEYWORDS.test(normalized)) {
        continue;
      }

      extracted.push(compact(normalized, 140));
    }
  }

  return uniqueStrings(extracted).slice(0, 5);
}

function deriveFallbackConventions(profile: WorkspaceProfile): string[] {
  return uniqueStrings([
    profile.availableTestCommands.length > 0
      ? `Use ${profile.availableTestCommands[0]} to validate impactful changes.`
      : "Prefer validating meaningful changes before packaging or release steps.",
    profile.hasCi
      ? "Keep changes aligned with CI workflow expectations."
      : "Add CI validation early so risky changes stay visible.",
    "Keep edits, tests, commands, and destructive flows approval-gated.",
  ]).slice(0, 3);
}

function buildStackSummary(profile: WorkspaceProfile, phase: WorkspacePhaseAssessment): string {
  const parts = [
    `Repo type: ${profile.repoType}`,
    profile.languages.length > 0 ? `Languages: ${profile.languages.join(", ")}` : undefined,
    profile.frameworks.length > 0 ? `Frameworks: ${profile.frameworks.join(", ")}` : undefined,
    profile.packageManagers.length > 0 ? `Package managers: ${profile.packageManagers.join(", ")}` : undefined,
    `Current phase: ${phase.phase}`,
  ].filter(Boolean);

  return `${parts.join(". ")}.`;
}

function derivePhaseGoals(profile: WorkspaceProfile, phase: WorkspacePhaseAssessment): string[] {
  switch (phase.phase) {
    case "idea-spec":
      return [
        "Turn core docs into an implementation milestone list.",
        "Create the initial project scaffold when key decisions are stable.",
      ];
    case "scaffolding":
      return [
        "Establish the source layout before broad implementation.",
        "Add or discover a test harness before riskier changes.",
      ];
    case "implementation":
      return [
        "Keep implementation aligned with the current architecture and conventions.",
        "Add focused tests around newly changed modules.",
      ];
    case "testing":
      return [
        "Prioritize validation loops and impacted test coverage.",
        "Use recent failures to guide the next safe iteration.",
      ];
    case "hardening":
      return [
        "Tighten validation, CI, and release readiness checks.",
        "Review dangerous areas before packaging or deployment changes.",
      ];
    case "maintenance":
      return [
        "Preserve continuity across sessions with concise project summaries.",
        "Prefer incremental validation before updating release flows.",
      ];
    default:
      return profile.likelyActions;
  }
}

function buildProjectMemorySummary(snapshot: Omit<WorkspaceProjectMemory, "summary" | "summaryFingerprint" | "updatedAt">, updatedAt: string): string {
  return [
    snapshot.purpose ? `Purpose: ${snapshot.purpose}` : undefined,
    `Stack: ${snapshot.stackSummary}`,
    snapshot.conventions.length > 0 ? ["Conventions:", ...snapshot.conventions.map((value) => `- ${value}`)].join("\n") : undefined,
    snapshot.availableTestCommands.length > 0 ? ["Test commands:", ...snapshot.availableTestCommands.map((value) => `- ${value}`)].join("\n") : undefined,
    snapshot.dangerousAreas.length > 0 ? ["Dangerous areas:", ...snapshot.dangerousAreas.map((value) => `- ${value}`)].join("\n") : undefined,
    snapshot.currentGoals.length > 0 ? ["Current goals:", ...snapshot.currentGoals.map((value) => `- ${value}`)].join("\n") : undefined,
    snapshot.canonicalSources.length > 0 ? `Sources: ${snapshot.canonicalSources.join(", ")}` : undefined,
    `Updated: ${updatedAt}`,
  ].filter(Boolean).join("\n\n");
}

function reuseSection<T>(
  key: WorkspaceProjectMemorySectionKey,
  sourceValue: unknown,
  nextValue: T,
  previousSnapshot: WorkspaceProjectMemory | undefined,
  currentValue: T | undefined,
): { value: T; fingerprint: string; changed: boolean } {
  const fingerprint = createFingerprint(sourceValue);
  const previousFingerprint = previousSnapshot?.sectionFingerprints[key];
  if (previousFingerprint && previousFingerprint === fingerprint && currentValue !== undefined) {
    return {
      value: currentValue,
      fingerprint,
      changed: false,
    };
  }

  return {
    value: nextValue,
    fingerprint,
    changed: previousFingerprint !== fingerprint,
  };
}

export function shouldRefreshProjectMemoryForPath(workspaceRoot: string, filePath: string): boolean {
  if (!filePath.startsWith(workspaceRoot)) {
    return false;
  }

  const relativePath = relative(workspaceRoot, filePath).replace(/\\/g, "/").toLowerCase();
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }

  if (PATHS_TRIGGERING_REFRESH.has(relativePath)) {
    return true;
  }

  return relativePath.startsWith("docs/")
    || relativePath.startsWith(".github/")
    || relativePath.startsWith("src/")
    || relativePath.startsWith("test/")
    || relativePath.startsWith("tests/")
    || relativePath.startsWith("app/")
    || relativePath.startsWith("lib/")
    || relativePath.endsWith(".md");
}

export async function initializeProjectMemorySnapshot(
  input: ProjectMemoryInitializerInput,
): Promise<ProjectMemoryInitializerResult> {
  const { sources, truncatedCount } = collectCanonicalSources(input.workspaceRoot, input.maxSourceFiles);
  const purpose = selectPurpose(sources);
  const stackSummary = buildStackSummary(input.profile, input.phase);
  const explicitConventions = extractConventionLines(sources);
  const conventions = explicitConventions.length > 0
    ? explicitConventions
    : deriveFallbackConventions(input.profile);
  const availableTestCommands = input.profile.availableTestCommands.slice(0, 6);
  const dangerousAreas = input.profile.riskAreas.slice(0, 6);
  const currentGoals = uniqueStrings([
    ...derivePhaseGoals(input.profile, input.phase),
    ...input.profile.likelyActions,
  ]).slice(0, 6);
  const canonicalSources = uniqueStrings(sources.map((source) => source.relativePath)).slice(0, 12);
  const sourceText = sources.map((source) => `${source.relativePath}\n${source.content}`).join("\n\n");
  const warnings: string[] = [];
  if (truncatedCount > 0) {
    warnings.push(`Project memory initialization skipped ${truncatedCount} lower-priority source files to stay within the configured scan budget.`);
  }

  if (!purpose) {
    warnings.push("Project memory purpose is using derived workspace signals because no primary doc summary was detected.");
  }
  if (explicitConventions.length === 0) {
    warnings.push("Project conventions were derived from workspace signals because no explicit instruction rules were detected.");
  }

  const previousSnapshot = input.previousSnapshot;
  const purposeSection = reuseSection(
    "purpose",
    purpose ?? sourceText,
    purpose,
    previousSnapshot,
    previousSnapshot?.purpose,
  );
  const stackSection = reuseSection(
    "stackSummary",
    { profile: input.profile, phase: input.phase.phase },
    stackSummary,
    previousSnapshot,
    previousSnapshot?.stackSummary,
  );
  const conventionsSection = reuseSection(
    "conventions",
    explicitConventions.length > 0 ? explicitConventions : conventions,
    conventions,
    previousSnapshot,
    previousSnapshot?.conventions,
  );
  const testsSection = reuseSection(
    "availableTestCommands",
    input.profile.availableTestCommands,
    availableTestCommands,
    previousSnapshot,
    previousSnapshot?.availableTestCommands,
  );
  const dangerousSection = reuseSection(
    "dangerousAreas",
    input.profile.riskAreas,
    dangerousAreas,
    previousSnapshot,
    previousSnapshot?.dangerousAreas,
  );
  const goalsSection = reuseSection(
    "currentGoals",
    { phase: input.phase.phase, likelyActions: input.profile.likelyActions, repoType: input.profile.repoType },
    currentGoals,
    previousSnapshot,
    previousSnapshot?.currentGoals,
  );

  const sectionFingerprints: WorkspaceProjectMemory["sectionFingerprints"] = {
    purpose: purposeSection.fingerprint,
    stackSummary: stackSection.fingerprint,
    conventions: conventionsSection.fingerprint,
    availableTestCommands: testsSection.fingerprint,
    dangerousAreas: dangerousSection.fingerprint,
    currentGoals: goalsSection.fingerprint,
  };
  const summaryFingerprint = createFingerprint({ sectionFingerprints, canonicalSources });
  const changed = !previousSnapshot || previousSnapshot.summaryFingerprint !== summaryFingerprint;
  const updatedAt = changed ? new Date().toISOString() : previousSnapshot.updatedAt;
  const snapshotWithoutSummary: Omit<WorkspaceProjectMemory, "summary" | "summaryFingerprint" | "updatedAt"> = {
    purpose: purposeSection.value,
    stackSummary: stackSection.value,
    conventions: conventionsSection.value,
    availableTestCommands: testsSection.value,
    dangerousAreas: dangerousSection.value,
    currentGoals: goalsSection.value,
    canonicalSources,
    sectionFingerprints,
  };

  return {
    snapshot: {
      ...snapshotWithoutSummary,
      summary: buildProjectMemorySummary(snapshotWithoutSummary, updatedAt),
      summaryFingerprint,
      updatedAt,
    },
    changed,
    warnings,
  };
}
