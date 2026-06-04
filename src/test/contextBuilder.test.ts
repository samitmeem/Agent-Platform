import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentContext } from "../agent/contextBuilder";

test("buildAgentContext composes selected text, file, and memory context", () => {
  const context = buildAgentContext({
    selectedText: "TokenSaviorService.invoke_tool",
    activeFilePath: "C:/repo/src/service.py",
    workspaceContextBundle: [
      "Workspace profile:",
      "- Repo type: node-typescript",
      "Lifecycle phase:",
      "- Phase: implementation",
      "Next actions:",
      "- Run npm test",
      "Warnings:",
      "- Workspace profile is fresh.",
    ].join("\n"),
    memoryContext: {
      recentRuns: ["Find symbol => located in service.py"],
      sessionHistory: "Session summary from the backend.",
      workspaceMemory: "Workspace summary from the extension.",
      projectMemory: "Saved project note.",
    },
  });

  assert.match(context ?? "", /Active file: C:\/repo\/src\/service.py/);
  assert.match(context ?? "", /Selected text:/);
  assert.match(context ?? "", /Workspace profile:/);
  assert.match(context ?? "", /Lifecycle phase:/);
  assert.match(context ?? "", /Next actions:/);
  assert.match(context ?? "", /Prior session history:/);
  assert.match(context ?? "", /Relevant project memory:/);
});

test("buildAgentContext enforces selected-text and overall context budgets", () => {
  const context = buildAgentContext({
    selectedText: "x".repeat(2_500),
    workspaceContextBundle: [
      "Workspace profile:",
      `- ${"profile ".repeat(900)}`,
    ].join("\n"),
  });

  assert.match(context ?? "", /selected text truncated/i);
  assert.match(context ?? "", /context truncated/i);
});

test("buildAgentContext respects a tighter custom context budget", () => {
  const context = buildAgentContext({
    workspaceContextBundle: [
      "Workspace profile:",
      `- ${"profile ".repeat(200)}`,
    ].join("\n"),
    maxContextChars: 500,
  });

  assert.ok((context?.length ?? 0) <= 500);
  assert.match(context ?? "", /context truncated/i);
});

test("buildAgentContext returns undefined when no context exists", () => {
  assert.equal(buildAgentContext({}), undefined);
});
