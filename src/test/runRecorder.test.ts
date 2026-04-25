import test from "node:test";
import assert from "node:assert/strict";

import { recordPreviewRun } from "../agent/runRecorder";
import { deriveRunFailureMessage, deriveRunOutcome, type AgentPreviewResult } from "../agent/runtime";
import { SessionStore } from "../state/sessionStore";
import type { ApprovalSettings } from "../policies/approvalPolicy";

const disabledSettings: ApprovalSettings = {
  editMode: "ask",
  testMode: "allow-trusted",
  commandMode: "allow-trusted",
  destructiveMode: "ask",
  autoSaveProjectMemory: false,
  persistRunHistory: true,
};

const enabledSettings: ApprovalSettings = {
  ...disabledSettings,
  autoSaveProjectMemory: true,
};

function createResult(): AgentPreviewResult {
  return {
    query: "Find TokenSaviorService and explain its dependencies",
    plan: {
      kind: "tool" as const,
      toolName: "find_symbol",
      arguments: { name: "TokenSaviorService" },
      reasoning: "Locate the symbol first.",
      source: "model" as const,
    },
    plans: [
      {
        kind: "tool" as const,
        toolName: "find_symbol",
        arguments: { name: "TokenSaviorService" },
        reasoning: "Locate symbol",
        source: "model" as const,
      },
      {
        kind: "tool" as const,
        toolName: "get_dependencies",
        arguments: { name: "TokenSaviorService" },
        reasoning: "Inspect dependencies",
        source: "model" as const,
      },
    ],
    answer: "The service depends on tool dispatch and schemas.",
    providerKind: "copilot" as const,
    toolResults: [
      {
        name: "find_symbol",
        ok: true,
        content: ["service.py:TokenSaviorService"],
      },
      {
        name: "get_dependencies",
        ok: true,
        content: ["tool_dispatch\ntool_schemas"],
      },
    ],
    trace: [],
  };
}

function createFailedResult(): AgentPreviewResult {
  return {
    query: "Apply the selected text to greet and validate",
    mode: "action",
    plan: {
      kind: "tool",
      toolName: "apply_symbol_change_and_validate",
      arguments: {
        symbol_name: "greet",
        file_path: "src/demo_module.py",
      },
      reasoning: "Apply the selected replacement and validate the impacted tests.",
      source: "heuristic",
    },
    answer: "Validation failed and the checkpoint was restored.",
    toolResult: {
      name: "apply_symbol_change_and_validate",
      ok: true,
      content: [JSON.stringify({ ok: false, summary: { headline: "Validation failed for greet" } })],
      error: null,
    },
    toolResults: [
      {
        name: "apply_symbol_change_and_validate",
        ok: true,
        content: [JSON.stringify({ ok: false, summary: { headline: "Validation failed for greet" } })],
        error: null,
      },
    ],
    trace: [],
  };
}

test("recordPreviewRun stores runs even when auto-save is disabled", async () => {
  const store = new SessionStore();
  const result = await recordPreviewRun({
    toolProviderRegistry: {
      routeTool: async () => {
        throw new Error("memory_save should not be called");
      },
    } as never,
    sessionStore: store,
    workspaceRoot: "C:/repo",
    getApprovalSettings: () => disabledSettings,
  }, {
    id: "run-disabled",
    query: "What is this project about?",
    result: createResult(),
    source: "command",
    activeFilePath: "C:/repo/src/token_savior/service_api/service.py",
  });

  assert.equal(result.memoryStatus.state, "disabled");
  assert.equal(store.getLastPreviewRun()?.memoryStatus?.state, "disabled");
  assert.match(store.getLastPreviewRun()?.activeFilePath ?? "", /src[\\/]token_savior[\\/]service_api[\\/]service\.py/);
});

test("recordPreviewRun auto-saves eligible runs to project memory", async () => {
  const store = new SessionStore();
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];

  const result = await recordPreviewRun({
    toolProviderRegistry: {
      routeTool: async (_workspaceRoot: string, toolName: string, args: Record<string, unknown>) => {
        calls.push({ toolName, args });
        return { name: toolName, ok: true, content: ["saved"] };
      },
      resolveMemoryCapability: () => ({ searchToolName: "memory_search", sessionHistoryToolName: "memory_session_history", saveToolName: "memory_save" }),
    } as never,
    sessionStore: store,
    workspaceRoot: "C:/repo",
    getApprovalSettings: () => enabledSettings,
  }, {
    id: "run-saved",
    query: "Find TokenSaviorService and explain its dependencies",
    result: createResult(),
    source: "chat",
    activeFilePath: "C:/repo/src/token_savior/service_api/service.py",
  });

  assert.equal(result.memoryStatus.state, "saved");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.toolName, "memory_save");
  assert.equal(store.getLastPreviewRun()?.memoryStatus?.state, "saved");
  assert.equal(store.getLastPreviewRun()?.source, "chat");
});

test("recordPreviewRun records auto-save failures without dropping the run", async () => {
  const store = new SessionStore();

  const result = await recordPreviewRun({
    toolProviderRegistry: {
      routeTool: async () => {
        throw new Error("database unavailable");
      },
      resolveMemoryCapability: () => ({ searchToolName: "memory_search", sessionHistoryToolName: "memory_session_history", saveToolName: "memory_save" }),
    } as never,
    sessionStore: store,
    workspaceRoot: "C:/repo",
    getApprovalSettings: () => enabledSettings,
  }, {
    id: "run-failed",
    query: "Find TokenSaviorService and explain its dependencies",
    result: createResult(),
    source: "command",
  });

  assert.equal(result.memoryStatus.state, "failed");
  assert.match(result.memoryStatus.reason, /database unavailable/i);
  assert.equal(store.getLastPreviewRun()?.id, "run-failed");
});

test("deriveRunOutcome and deriveRunFailureMessage reflect failed tool results", () => {
  const result = createFailedResult();

  assert.equal(deriveRunOutcome(result), "failed");
  assert.match(deriveRunFailureMessage(result) ?? "", /validation failed for greet/i);
});
