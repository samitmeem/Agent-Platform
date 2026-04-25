import test from "node:test";
import assert from "node:assert/strict";

import { shouldRequireApproval } from "../policies/approvalPolicy";
import { ToolPolicyRegistry } from "../policies/toolPolicy";

const registry = new ToolPolicyRegistry();
registry.register([
  { toolName: "find_symbol", title: "Find Symbol", safetyClass: "read", mutatesWorkspace: false, requiresApprovalByDefault: false },
  { toolName: "apply_symbol_change_and_validate", title: "Apply Change", safetyClass: "edit", mutatesWorkspace: true, requiresApprovalByDefault: true },
  { toolName: "run_project_action", title: "Run Action", safetyClass: "command", mutatesWorkspace: false, requiresApprovalByDefault: false },
]);

const baseSettings = {
  editMode: "ask" as const,
  testMode: "allow-trusted" as const,
  commandMode: "allow-trusted" as const,
  destructiveMode: "ask" as const,
  autoSaveProjectMemory: false,
  persistRunHistory: true,
};

test("shouldRequireApproval skips approval for read tools", () => {
  const decision = shouldRequireApproval(registry.resolve("find_symbol"), baseSettings, false);
  assert.equal(decision.required, false);
});

test("shouldRequireApproval requires approval for edit tools by default", () => {
  const decision = shouldRequireApproval(registry.resolve("apply_symbol_change_and_validate"), baseSettings, true);
  assert.equal(decision.required, true);
});

test("shouldRequireApproval auto-allows trusted command tools when configured", () => {
  const decision = shouldRequireApproval(registry.resolve("run_project_action"), baseSettings, true);
  assert.equal(decision.required, false);
});
