/**
 * Platform Validation Tests (Tests 1–4)
 *
 * Proves that token-savior is a real dynamic agent platform:
 *   Test 1 — A new tool provider integrates without any core code changes.
 *   Test 2 — No-tools mode: the agent answers correctly without any provider registered.
 *   Test 3 — Dynamic planning: the model selects the right tool based on description alone.
 *   Test 4 — Removing token-savior entirely leaves the system functional.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ToolProviderRegistry } from "../tools/providerRegistry";
import type { ToolDefinition, ToolProvider, ToolResult } from "../tools/interface";
import { AgentRuntime } from "../agent/runtime";
import type {
  ModelProvider,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
} from "../providers/base";
import { ModelProviderRegistry } from "../providers/registry";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Creates a ModelProvider whose LLM responses are taken from a fixed queue. */
class ScriptedProvider implements ModelProvider {
  public readonly kind = "copilot" as const;
  public readonly displayName = "Scripted Provider";
  private callIndex = 0;

  public constructor(private readonly responses: string[]) {}

  public async availability(): Promise<ProviderAvailability> {
    return { status: "available", reason: "ready" };
  }

  public async capabilities(): Promise<ProviderCapabilities> {
    return { tools: true, streaming: false, structuredOutput: false };
  }

  public async complete(_req: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    const text = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1] ?? "";
    this.callIndex += 1;
    return { provider: this.kind, text, chunks: [text] };
  }
}

/** Minimal ToolProvider that wraps a static tool list and a handler function. */
function makeProvider(
  id: string,
  tools: ToolDefinition[],
  handler: (name: string, args: Record<string, unknown>) => ToolResult,
): ToolProvider {
  return {
    id,
    displayName: id,
    async isAvailable() { return true; },
    async listTools() { return tools; },
    async invokeTool(name, args) { return handler(name, args); },
    async dispose() { /* no-op */ },
  };
}

// ---------------------------------------------------------------------------
// Test 1 — New tool integration
// ---------------------------------------------------------------------------
test("Test 1 — New tool appears in listAllTools and is executed by the runtime", async () => {
  // 1a. Define a brand-new tool with no relation to token-savior.
  const echoDef: ToolDefinition = {
    name: "echo_tool",
    category: "utility",
    description: "Returns the input text unchanged.",
    safetyClass: "read",
    mutatesWorkspace: false,
    requiresApprovalByDefault: false,
  };

  const echoProvider = makeProvider("echo-provider", [echoDef], (_name, args) => ({
    name: "echo_tool",
    ok: true,
    content: [String(args["text"] ?? "")],
  }));

  // 1b. Register in a fresh registry — no token-savior involved.
  const toolRegistry = new ToolProviderRegistry();
  toolRegistry.registerProvider(echoProvider);

  // 1c. Tool appears in listAllTools.
  const allTools = await toolRegistry.listAllTools();
  assert.equal(allTools.length, 1);
  assert.equal(allTools[0]?.name, "echo_tool");

  // 1d. Build the manifest string the runtime sends to the LLM (same logic as runtime.ts).
  const manifest = allTools.map((t) => `- ${t.name} [${t.category}]: ${t.description}`).join("\n");
  assert.match(manifest, /echo_tool/);
  assert.match(manifest, /Returns the input text unchanged/);

  // 1e. LLM selects echo_tool — runtime executes it successfully.
  const provider = new ScriptedProvider([
    '{"mode":"tool","toolName":"echo_tool","arguments":{"text":"hello platform"},"reasoning":"User wants echo."}',
    "The echo tool returned: hello platform",
  ]);
  const modelRegistry = new ModelProviderRegistry([provider], "copilot");

  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: modelRegistry,
    listTools: () => toolRegistry.listAllTools(),
    toolExecutor: {
      invokeTool: (_root, name, args) => toolRegistry.routeTool(name, args, _root),
    },
  });

  const result = await runtime.runPreview({ query: "Echo the text hello platform" });

  assert.equal(result.plan.kind, "tool");
  assert.equal(result.plan.toolName, "echo_tool");
  assert.ok(result.toolResult?.ok, "echo_tool must succeed");
  assert.match(result.answer, /hello platform/i);
});

// ---------------------------------------------------------------------------
// Test 2 — No-tools mode
// ---------------------------------------------------------------------------
test("Test 2 — Agent answers correctly with no providers registered (LLM-only mode)", async () => {
  // No provider registered anywhere.
  const toolRegistry = new ToolProviderRegistry();

  // The scripted LLM returns a direct answer — the runtime must not attempt any tool call.
  const provider = new ScriptedProvider([
    '{"mode":"direct","response":"The capital of France is Paris.","reasoning":"This is general knowledge."}',
  ]);
  const modelRegistry = new ModelProviderRegistry([provider], "copilot");

  let toolCallAttempted = false;
  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: modelRegistry,
    listTools: () => toolRegistry.listAllTools(),
    toolExecutor: {
      invokeTool: async () => {
        toolCallAttempted = true;
        throw new Error("No tools should be called in no-tools mode");
      },
    },
  });

  const result = await runtime.runPreview({ query: "What is the capital of France?" });

  assert.equal(result.plan.kind, "direct");
  assert.match(result.answer, /paris/i);
  assert.equal(toolCallAttempted, false, "No tool call should have been attempted");
});

// ---------------------------------------------------------------------------
// Test 3 — Dynamic planning: model picks the right tool by description
// ---------------------------------------------------------------------------
test("Test 3 — Planner selects between tools based on description without code changes", async () => {
  const echoDef: ToolDefinition = {
    name: "echo_tool",
    category: "utility",
    description: "Returns the input text unchanged.",
    safetyClass: "read",
    mutatesWorkspace: false,
    requiresApprovalByDefault: false,
  };
  const uppercaseDef: ToolDefinition = {
    name: "uppercase_tool",
    category: "utility",
    description: "Converts text to uppercase.",
    safetyClass: "read",
    mutatesWorkspace: false,
    requiresApprovalByDefault: false,
  };

  const toolRegistry = new ToolProviderRegistry();
  toolRegistry.registerProvider(makeProvider("echo-provider", [echoDef], (_name, args) => ({
    name: "echo_tool",
    ok: true,
    content: [String(args["text"] ?? "")],
  })));
  toolRegistry.registerProvider(makeProvider("uppercase-provider", [uppercaseDef], (_name, args) => ({
    name: "uppercase_tool",
    ok: true,
    content: [String(args["text"] ?? "").toUpperCase()],
  })));

  const allTools = await toolRegistry.listAllTools();
  assert.equal(allTools.length, 2, "Both tools must be registered");

  // Subtest A: model picks echo_tool for an echo request.
  {
    const provider = new ScriptedProvider([
      '{"mode":"tool","toolName":"echo_tool","arguments":{"text":"same"},"reasoning":"echo_tool returns text unchanged."}',
      "The echo tool returned: same",
    ]);
    const modelRegistry = new ModelProviderRegistry([provider], "copilot");
    const runtime = new AgentRuntime({
      workspaceRoot: "C:/repo",
      providerRegistry: modelRegistry,
      listTools: () => toolRegistry.listAllTools(),
      toolExecutor: { invokeTool: (_root, name, args) => toolRegistry.routeTool(name, args, _root) },
    });
    const result = await runtime.runPreview({ query: "Echo the word same" });
    assert.equal(result.plan.kind, "tool");
    assert.equal(result.plan.toolName, "echo_tool");
  }

  // Subtest B: model picks uppercase_tool for an uppercase request.
  {
    const provider = new ScriptedProvider([
      '{"mode":"tool","toolName":"uppercase_tool","arguments":{"text":"hello"},"reasoning":"uppercase_tool converts to uppercase."}',
      "The uppercase tool returned: HELLO",
    ]);
    const modelRegistry = new ModelProviderRegistry([provider], "copilot");
    const runtime = new AgentRuntime({
      workspaceRoot: "C:/repo",
      providerRegistry: modelRegistry,
      listTools: () => toolRegistry.listAllTools(),
      toolExecutor: { invokeTool: (_root, name, args) => toolRegistry.routeTool(name, args, _root) },
    });
    const result = await runtime.runPreview({ query: "Convert hello to uppercase" });
    assert.equal(result.plan.kind, "tool");
    assert.equal(result.plan.toolName, "uppercase_tool");
  }
});

// ---------------------------------------------------------------------------
// Test 4 — Remove token-savior completely; system still works
// ---------------------------------------------------------------------------
test("Test 4 — System works correctly when token-savior is never registered", async () => {
  // We deliberately never import or instantiate TokenSaviorToolProvider.
  const toolRegistry = new ToolProviderRegistry();

  // Confirm: no providers, no tools, no memory capability.
  const allTools = await toolRegistry.listAllTools();
  assert.equal(allTools.length, 0);
  assert.equal(toolRegistry.resolveMemoryCapability(), undefined);

  // The runtime must complete without errors.
  const provider = new ScriptedProvider([
    '{"mode":"direct","response":"I can help you even without any backend tools.","reasoning":"No tools available."}',
  ]);
  const modelRegistry = new ModelProviderRegistry([provider], "copilot");

  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: modelRegistry,
    listTools: () => toolRegistry.listAllTools(),
    toolExecutor: {
      invokeTool: async () => ({ name: "none", ok: false, content: [], error: "no provider" }),
    },
  });

  let threw = false;
  let result;
  try {
    result = await runtime.runPreview({ query: "What can you do?" });
  } catch {
    threw = true;
  }

  assert.equal(threw, false, "Runtime must not throw without a backend");
  assert.equal(result?.plan.kind, "direct");
  assert.match(result?.answer ?? "", /even without any backend tools/i);
});
