import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const extensionRoot = resolve(__dirname, "..", "..");
const repoRoot = resolve(extensionRoot, "..");

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

test("extension manifest stays publication ready", () => {
  const manifest = readJsonFile<Record<string, unknown>>(resolve(extensionRoot, "package.json"));
  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  const keywords = Array.isArray(manifest.keywords) ? manifest.keywords.map(String) : [];
  const categories = Array.isArray(manifest.categories) ? manifest.categories.map(String) : [];
  const contributes = (manifest.contributes ?? {}) as { languageModelTools?: unknown[] };
  const languageModelTools = Array.isArray(contributes.languageModelTools) ? contributes.languageModelTools : [];
  const configuration = (manifest.contributes ?? {}) as {
    configuration?: { properties?: Record<string, { default?: unknown; enum?: unknown[] }> };
  };
  const configurationProperties = configuration.configuration?.properties ?? {};
  const repository = manifest.repository as { url?: unknown } | undefined;
  const galleryBanner = manifest.galleryBanner as { color?: unknown; theme?: unknown } | undefined;
  const capabilities = manifest.capabilities as {
    untrustedWorkspaces?: { supported?: unknown; description?: unknown };
  } | undefined;
  const extensionKind = Array.isArray(manifest.extensionKind) ? manifest.extensionKind.map(String) : [];

  assert.equal(manifest.publisher, "samitmeem");
  assert.equal(manifest.preview, true);
  assert.equal(manifest.icon, "media/icon.png");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.markdown, "github");
  assert.notEqual(manifest.private, true);
  assert.match(String(manifest.version ?? ""), /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
  assert.doesNotMatch(String(manifest.description ?? ""), /scaffold/i);
  assert.match(String(repository?.url ?? ""), /github\.com\/samitmeem\/Agent-Platform/i);
  assert.ok(keywords.includes("agent-platform"));
  assert.ok(categories.includes("AI"));
  assert.ok(extensionKind.includes("workspace"));
  assert.equal(galleryBanner?.color, "#0f172a");
  assert.equal(galleryBanner?.theme, "dark");
  assert.equal(capabilities?.untrustedWorkspaces?.supported, true);
  assert.match(String(capabilities?.untrustedWorkspaces?.description ?? ""), /approval|read-only|read oriented/i);
  assert.equal(typeof scripts.package, "string");
  assert.equal(typeof scripts["package:precheck"], "string");
  assert.equal(typeof scripts["publish:dry-run"], "string");
  assert.equal(typeof scripts["publish:vsce"], "string");
  assert.equal(typeof scripts["publish:ovsx"], "string");

  const toolNames = languageModelTools.map((tool) => String((tool as { name?: unknown }).name ?? ""));
  const toolReferenceNames = languageModelTools.map((tool) => String((tool as { toolReferenceName?: unknown }).toolReferenceName ?? ""));
  const expectedReadOnlyTools = [
    "agent-platform_find_symbol",
    "agent-platform_get_change_impact",
    "agent-platform_get_dependencies",
    "agent-platform_get_workspace_profile",
    "agent-platform_detect_phase",
    "agent-platform_get_next_actions",
    "agent-platform_get_recent_run_summary",
    "agent-platform_get_project_memory_summary",
    "agent-platform_get_context_bundle",
    "agent-platform_list_test_commands",
    "agent-platform_discover_project_actions",
  ];

  assert.equal(toolNames.length, expectedReadOnlyTools.length);
  for (const toolName of expectedReadOnlyTools) {
    assert.ok(toolNames.includes(toolName), `Expected native Copilot tool ${toolName} to be contributed.`);
  }

  for (const tool of languageModelTools) {
    const candidate = tool as {
      toolReferenceName?: unknown;
      canBeReferencedInPrompt?: unknown;
      modelDescription?: unknown;
    };
    assert.equal(typeof candidate.toolReferenceName, "string");
    assert.equal(candidate.canBeReferencedInPrompt, true);
    assert.equal(typeof candidate.modelDescription, "string");
  }

  assert.ok(toolReferenceNames.includes("get_workspace_profile"));
  assert.ok(toolReferenceNames.includes("detect_phase"));
  assert.ok(toolReferenceNames.includes("get_context_bundle"));
  assert.ok(toolReferenceNames.includes("discover_project_actions"));
  assert.ok(!toolNames.includes("agent-platform_run_project_action"));
  assert.ok(!toolNames.includes("agent-platform_apply_symbol_change_and_validate"));
  assert.ok(!toolNames.includes("agent-platform_restore_checkpoint"));
  assert.ok(!toolNames.includes("agent-platform_run_impacted_tests"));

  assert.deepEqual(configurationProperties["agentPlatform.automationProfile"]?.enum, [
    "conservative",
    "balanced",
    "aggressive-but-safe",
  ]);
  assert.equal(configurationProperties["agentPlatform.automationProfile"]?.default, "balanced");
  assert.equal(configurationProperties["agentPlatform.refreshDebounceMs"]?.default, 250);
  assert.equal(configurationProperties["agentPlatform.profileScanEntryLimit"]?.default, 160);
  assert.equal(configurationProperties["agentPlatform.projectMemorySourceFileLimit"]?.default, 16);
  assert.equal(configurationProperties["agentPlatform.actionDiscoveryLimit"]?.default, 8);
  assert.equal(configurationProperties["agentPlatform.maxWorkspaceSuggestions"]?.default, 6);
  assert.equal(configurationProperties["agentPlatform.maxContextBundleChars"]?.default, 6000);
  assert.equal(configurationProperties["agentPlatform.staleStateThresholdMinutes"]?.default, 60);
  assert.equal(configurationProperties["agentPlatform.suggestionNoiseThreshold"]?.default, 3);
});

test("extension packaging docs and assets exist", () => {
  const requiredFiles = [
    "README.md",
    "CHANGELOG.md",
    "LICENSE.txt",
    ".vscodeignore",
    "media/icon.png",
    "media/icon.svg",
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(
      existsSync(resolve(extensionRoot, relativePath)),
      true,
      `Expected ${relativePath} to exist for extension packaging.`,
    );
  }

  const readme = readFileSync(resolve(extensionRoot, "README.md"), "utf-8");
  assert.match(readme, /npm run package/i);
  assert.match(readme, /publish:dry-run/i);
  assert.match(readme, /VSCE_PAT/i);
  assert.match(readme, /OVSX_PAT/i);
});

test("extension release workflow packages before publishing", () => {
  const workflow = readFileSync(resolve(extensionRoot, ".github", "workflows", "ci.yml"), "utf-8");

  assert.match(workflow, /actions\/checkout@v4/);
  assert.match(workflow, /actions\/setup-node@v4/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run compile/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run publish:dry-run/);
  assert.match(workflow, /npm run publish:vsce/);
  assert.match(workflow, /npm run publish:ovsx/);
  assert.match(workflow, /refs\/tags\/ext-v/);
});