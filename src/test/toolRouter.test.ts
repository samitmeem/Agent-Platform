import test from "node:test";
import assert from "node:assert/strict";

import { ToolApprovalDeniedError, ToolRouter } from "../agent/toolRouter";
import type { ServiceToolResult } from "../backend/protocol";

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
    gateway: {
      invokeTool: async (_root: string, toolName: string): Promise<ServiceToolResult> => {
        calls.push(toolName);
        return { name: toolName, ok: true, content: ["ok"] };
      },
    } as never,
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
    gateway: {
      invokeTool: async (): Promise<ServiceToolResult> => ({ name: "apply_symbol_change_and_validate", ok: true, content: ["ok"] }),
    } as never,
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
    gateway: {
      invokeTool: async (_root: string, toolName: string): Promise<ServiceToolResult> => ({ name: toolName, ok: true, content: ["done"] }),
    } as never,
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
