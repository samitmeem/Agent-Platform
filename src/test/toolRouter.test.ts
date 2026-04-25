import test from "node:test";
import assert from "node:assert/strict";

import { ToolApprovalDeniedError, ToolRouter } from "../agent/toolRouter";
import type { ToolResult } from "../tools/interface";
import { ToolPolicyRegistry, globalToolPolicyRegistry } from "../policies/toolPolicy";
import type { ToolProviderRegistry } from "../tools/providerRegistry";

function mockRegistry(fn: (name: string) => ToolResult): ToolProviderRegistry {
  return {
    routeTool: async (name: string, _args: Record<string, unknown>, _root: string): Promise<ToolResult> => fn(name),
  } as unknown as ToolProviderRegistry;
}

const approvalSettings = {
  editMode: "ask" as const,
  testMode: "allow-trusted" as const,
  commandMode: "allow-trusted" as const,
  destructiveMode: "ask" as const,
  autoSaveProjectMemory: false,
  persistRunHistory: true,
};

test("ToolRouter runs read tools without approval", async () => {
  const calls: string[] = [];
  const router = new ToolRouter({
    toolProviderRegistry: mockRegistry((toolName) => { calls.push(toolName); return { name: toolName, ok: true, content: ["ok"] }; }),
    policyRegistry: globalToolPolicyRegistry,
    workspaceRoot: "C:/repo",
    getApprovalSettings: () => approvalSettings,
    isWorkspaceTrusted: () => false,
  });

  const result = await router.invokeTool({ toolName: "find_symbol" });

  assert.deepEqual(calls, ["find_symbol"]);
  assert.equal(result.ok, true);
});

test("ToolRouter rejects edit tools when approval is denied", async () => {
  const router = new ToolRouter({
    toolProviderRegistry: mockRegistry((name) => ({ name, ok: true, content: ["ok"] })),
    policyRegistry: globalToolPolicyRegistry,
    workspaceRoot: "C:/repo",
    getApprovalSettings: () => approvalSettings,
    isWorkspaceTrusted: () => false,
    requestApproval: async () => false,
  });

  await assert.rejects(
    router.invokeTool({ toolName: "apply_symbol_change_and_validate" }),
    ToolApprovalDeniedError,
  );
});

test("ToolRouter auto-allows trusted command tools and calls completion hook", async () => {
  const completed: string[] = [];
  const router = new ToolRouter({
    toolProviderRegistry: mockRegistry((name) => ({ name, ok: true, content: ["done"] })),
    policyRegistry: globalToolPolicyRegistry,
    workspaceRoot: "C:/repo",
    getApprovalSettings: () => approvalSettings,
    isWorkspaceTrusted: () => true,
    requestApproval: async () => {
      throw new Error("approval should not have been requested");
    },
    onToolCompleted: async (toolName) => {
      completed.push(toolName);
    },
  });

  await router.invokeTool({ toolName: "run_project_action", argumentsPayload: { action_id: "python:test" } });

  assert.deepEqual(completed, ["run_project_action"]);
});
