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
  const repository = manifest.repository as { url?: unknown } | undefined;
  const galleryBanner = manifest.galleryBanner as { color?: unknown; theme?: unknown } | undefined;
  const capabilities = manifest.capabilities as {
    untrustedWorkspaces?: { supported?: unknown; description?: unknown };
  } | undefined;
  const extensionKind = Array.isArray(manifest.extensionKind) ? manifest.extensionKind.map(String) : [];

  assert.equal(manifest.publisher, "mibayy");
  assert.equal(manifest.preview, true);
  assert.equal(manifest.icon, "media/icon.png");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.markdown, "github");
  assert.notEqual(manifest.private, true);
  assert.match(String(manifest.version ?? ""), /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/);
  assert.doesNotMatch(String(manifest.description ?? ""), /scaffold/i);
  assert.match(String(repository?.url ?? ""), /github\.com\/Mibayy\/token-savior/i);
  assert.ok(keywords.includes("token-savior"));
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
  assert.match(readme, /Workspace trust behavior/i);
  assert.match(readme, /untrusted workspaces/i);
  assert.match(readme, /Release operations/i);
  assert.match(readme, /release_tag/i);
  assert.match(readme, /publish_marketplace/i);
  assert.match(readme, /publish_openvsx/i);
});

test("extension release workflow packages before publishing", () => {
  const workflow = readFileSync(resolve(repoRoot, ".github", "workflows", "extension-release.yml"), "utf-8");

  assert.match(workflow, /python scripts\/validate_vscode_agent_phase10\.py/);
  assert.match(workflow, /python scripts\/validate_release_operations\.py/);
  assert.match(workflow, /npm run package/);
  assert.match(workflow, /npm run publish:vsce/);
  assert.match(workflow, /npm run publish:ovsx/);
  assert.match(workflow, /upload-artifact@v4/);
  assert.match(workflow, /workflow_dispatch:\s*[\s\S]*release_tag/);
  assert.match(workflow, /workflow_dispatch:\s*[\s\S]*publish_marketplace/);
  assert.match(workflow, /workflow_dispatch:\s*[\s\S]*publish_openvsx/);
  assert.match(workflow, /workflow_dispatch:\s*[\s\S]*upload_to_release/);
});