import test from "node:test";
import assert from "node:assert/strict";

import { shouldRequireApproval } from "../policies/approvalPolicy";
import { resolveToolPolicy } from "../policies/toolPolicy";

const baseSettings = {
  editMode: "ask" as const,
  testMode: "allow-trusted" as const,
  commandMode: "allow-trusted" as const,
  destructiveMode: "ask" as const,
  autoSaveProjectMemory: false,
  persistRunHistory: true,
};

test("shouldRequireApproval skips approval for read tools", () => {
  const decision = shouldRequireApproval(resolveToolPolicy("find_symbol"), baseSettings, false);
  assert.equal(decision.required, false);
});

test("shouldRequireApproval requires approval for edit tools by default", () => {
  const decision = shouldRequireApproval(resolveToolPolicy("apply_symbol_change_and_validate"), baseSettings, true);
  assert.equal(decision.required, true);
});

test("shouldRequireApproval auto-allows trusted command tools when configured", () => {
  const decision = shouldRequireApproval(resolveToolPolicy("run_project_action"), baseSettings, true);
  assert.equal(decision.required, false);
});
