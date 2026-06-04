import test from "node:test";
import assert from "node:assert/strict";

import { AgentRuntime, AgentRuntimeCancelledError } from "../agent/runtime";
import type { ServiceToolResult } from "../backend/protocol";
import type {
  ModelProvider,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
} from "../providers/base";
import { ModelProviderRegistry } from "../providers/registry";

class FakeProvider implements ModelProvider {
  public readonly kind = "copilot" as const;
  public readonly displayName = "Fake Provider";
  private callIndex = 0;

  public constructor(private readonly responses: string[]) {}

  public async availability(): Promise<ProviderAvailability> {
    return { status: "available", reason: "ready" };
  }

  public async capabilities(): Promise<ProviderCapabilities> {
    return {
      tools: true,
      streaming: false,
      structuredOutput: false,
    };
  }

  public async complete(_request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    const text = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1] ?? "";
    this.callIndex += 1;
    return {
      provider: this.kind,
      text,
      chunks: [text],
    };
  }
}

test("AgentRuntime can answer directly without a provider match", async () => {
  const registry = new ModelProviderRegistry([], "copilot");
  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: registry,
    toolExecutor: {
      invokeTool: async () => {
        throw new Error("tool should not have been called");
      },
    },
  });

  const result = await runtime.runPreview({
    query: "Can you help me?",
  });

  assert.equal(result.plan.kind, "direct");
  assert.match(result.answer, /project summary|finding a symbol|project memory/i);
  assert.equal(result.trace[0]?.phase, "provider");
  assert.equal(result.trace[1]?.phase, "plan");
  assert.equal(result.trace[2]?.phase, "answer");
});

test("AgentRuntime executes one tool call and summarizes the result", async () => {
  const provider = new FakeProvider([
    '{"mode":"tool","toolName":"get_project_summary","arguments":{},"reasoning":"Need the repo summary."}',
    "The project summary says this repository exposes a backend service and VS Code extension shell.",
  ]);
  const registry = new ModelProviderRegistry([provider], "copilot");
  const toolResult: ServiceToolResult = {
    name: "get_project_summary",
    ok: true,
    content: ["Project summary raw output"],
  };
  let toolCalls = 0;
  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: registry,
    toolExecutor: {
      invokeTool: async (_root, name) => {
        toolCalls += 1;
        assert.equal(name, "get_project_summary");
        return toolResult;
      },
    },
  });

  const result = await runtime.runPreview({
    query: "What is this project about?",
  });

  assert.equal(toolCalls, 1);
  assert.equal(result.plan.kind, "tool");
  assert.equal(result.plan.toolName, "get_project_summary");
  assert.match(result.answer, /backend service and VS Code extension shell/i);
  assert.equal(result.toolResult?.name, "get_project_summary");
  assert.deepEqual(result.trace.map((entry) => entry.phase), ["provider", "plan", "tool", "tool", "control", "answer"]);
});

test("AgentRuntime can execute a bounded multi-step tool sequence", async () => {
  const provider = new FakeProvider([
    '{"mode":"tool","toolName":"find_symbol","arguments":{"name":"TokenSaviorService"},"reasoning":"Locate the symbol first."}',
    '{"mode":"tool","toolName":"get_dependencies","arguments":{"name":"TokenSaviorService"},"reasoning":"Inspect dependencies after locating it."}',
    "The symbol is defined in service.py and depends on the tool schema and dispatch layers.",
  ]);
  const registry = new ModelProviderRegistry([provider], "copilot");
  const toolResultsByName = new Map<string, ServiceToolResult>([
    [
      "find_symbol",
      {
        name: "find_symbol",
        ok: true,
        content: [JSON.stringify([{ file: "src/token_savior/service_api/service.py", line: 12 }])],
      },
    ],
    [
      "get_dependencies",
      {
        name: "get_dependencies",
        ok: true,
        content: ["tool_dispatch\ntool_schemas"],
      },
    ],
  ]);
  const calledTools: string[] = [];
  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: registry,
    toolExecutor: {
      invokeTool: async (_root, name) => {
        calledTools.push(name);
        const result = toolResultsByName.get(name);
        assert.ok(result, `Unexpected tool call: ${name}`);
        return result;
      },
    },
  });

  const result = await runtime.runPreview({
    query: "Find TokenSaviorService and explain its dependencies",
    maxToolSteps: 2,
  });

  assert.deepEqual(calledTools, ["find_symbol", "get_dependencies"]);
  assert.equal(result.toolResults?.length, 2);
  assert.match(result.answer, /depends on the tool schema and dispatch layers/i);
  assert.deepEqual(result.plans?.filter((plan) => plan.kind === "tool").map((plan) => plan.toolName), ["find_symbol", "get_dependencies"]);
  assert.ok(result.trace.some((entry) => entry.phase === "control"));
});

test("AgentRuntime throws a cancellation error when cancelled mid-run", async () => {
  const registry = new ModelProviderRegistry([], "copilot");
  const cancellationSignal = { isCancellationRequested: false };
  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: registry,
    toolExecutor: {
      invokeTool: async () => {
        cancellationSignal.isCancellationRequested = true;
        return {
          name: "get_project_summary",
          ok: true,
          content: ["summary"],
        };
      },
    },
  });

  await assert.rejects(
    runtime.runPreview({
      query: "What is this project about?",
      cancellationSignal,
    }),
    AgentRuntimeCancelledError,
  );
});

test("AgentRuntime can execute a bounded action-mode tool call", async () => {
  const registry = new ModelProviderRegistry([], "copilot");
  const calledTools: string[] = [];
  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: registry,
    toolExecutor: {
      invokeTool: async (_root, name, argumentsPayload) => {
        calledTools.push(name);
        assert.equal(name, "run_impacted_tests");
        assert.deepEqual(argumentsPayload.symbol_names, ["TokenSaviorService"]);
        return {
          name,
          ok: true,
          content: ["2 impacted tests passed"],
        };
      },
    },
  });

  const result = await runtime.runAction({
    query: "Run impacted tests for TokenSaviorService",
    maxToolSteps: 2,
  });

  assert.equal(result.mode, "action");
  assert.deepEqual(calledTools, ["run_impacted_tests"]);
  assert.equal(result.plan.kind, "tool");
  assert.equal(result.plan.toolName, "run_impacted_tests");
  assert.match(result.answer, /2 impacted tests passed/i);
  assert.equal(result.trace[0]?.phase, "control");
});

test("AgentRuntime can continue a bounded action workflow from apply to impacted tests", async () => {
  const registry = new ModelProviderRegistry([], "copilot");
  const calledTools: string[] = [];
  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: registry,
    toolExecutor: {
      invokeTool: async (_root, name, argumentsPayload) => {
        calledTools.push(name);
        if (name === "apply_symbol_change_and_validate") {
          assert.equal(argumentsPayload.symbol_name, "TokenSaviorService.invoke_tool");
          return {
            name,
            ok: true,
            content: [JSON.stringify({ checkpoint_id: "ckpt-1", validated: true })],
          };
        }

        assert.equal(name, "run_impacted_tests");
        assert.deepEqual(argumentsPayload.symbol_names, ["TokenSaviorService.invoke_tool"]);
        return {
          name,
          ok: true,
          content: ["2 impacted tests passed"],
        };
      },
    },
  });

  const result = await runtime.runAction({
    query: "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
    selectedText: "def invoke_tool(self, name: str) -> str:\n    return name",
    activeFilePath: "src/token_savior/service_api/service.py",
    maxToolSteps: 3,
  });

  assert.deepEqual(calledTools, ["apply_symbol_change_and_validate", "run_impacted_tests"]);
  assert.deepEqual(result.plans?.filter((plan) => plan.kind === "tool").map((plan) => plan.toolName), [
    "apply_symbol_change_and_validate",
    "run_impacted_tests",
  ]);
  assert.equal(result.toolResults?.length, 2);
  assert.match(result.answer, /2 impacted tests passed/i);
});
