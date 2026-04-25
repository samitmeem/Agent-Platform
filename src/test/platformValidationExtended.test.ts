/**
 * Extended Platform Validation Tests (Tests 5–8)
 *
 * Proves the system handles real-world tool ecosystems dynamically:
 *   Test 5 — External tool simulation: code summarizer, dependency analyzer, workflow executor.
 *   Test 6 — Multi-tool reasoning: two tools chained to answer a compound query.
 *   Test 7 — Tool discovery at scale: 10+ tools all appear in the manifest; correct one selected.
 *   Test 8 — Tool replacement: one tool swapped for another; no hardcoded assumptions break.
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

function makeDef(name: string, description: string, category = "utility"): ToolDefinition {
  return {
    name,
    category,
    description,
    safetyClass: "read",
    mutatesWorkspace: false,
    requiresApprovalByDefault: false,
  };
}

// ---------------------------------------------------------------------------
// Test 5 — External tool simulation
// ---------------------------------------------------------------------------
test("Test 5 — External tools (code-summarizer, dep-analyzer, workflow-executor) register and invoke correctly", async () => {
  // Three tools inspired by real-world agent repositories.
  const codeSummarizerDef = makeDef(
    "code_summarizer",
    "Summarizes the purpose and structure of a code file or module. Inspired by karpathy-skills.",
    "analysis",
  );
  const depAnalyzerDef = makeDef(
    "dependency_analyzer",
    "Lists all direct and transitive dependencies of a given module or package.",
    "analysis",
  );
  const workflowExecutorDef = makeDef(
    "workflow_executor",
    "Executes a named workflow step by step and returns the output. Inspired by Archon.",
    "automation",
  );

  const toolRegistry = new ToolProviderRegistry();
  toolRegistry.registerProvider(makeProvider("code-summarizer-provider", [codeSummarizerDef], () => ({
    name: "code_summarizer",
    ok: true,
    content: ["This module exposes a REST API for token budget management."],
  })));
  toolRegistry.registerProvider(makeProvider("dep-analyzer-provider", [depAnalyzerDef], () => ({
    name: "dependency_analyzer",
    ok: true,
    content: ["Dependencies: fastapi, pydantic, httpx"],
  })));
  toolRegistry.registerProvider(makeProvider("workflow-executor-provider", [workflowExecutorDef], () => ({
    name: "workflow_executor",
    ok: true,
    content: ["Workflow completed: 3 steps executed, 0 failures."],
  })));

  const allTools = await toolRegistry.listAllTools();
  assert.equal(allTools.length, 3);

  const names = allTools.map((t) => t.name);
  assert.ok(names.includes("code_summarizer"));
  assert.ok(names.includes("dependency_analyzer"));
  assert.ok(names.includes("workflow_executor"));

  // Verify each tool executes via routeTool.
  const summaryResult = await toolRegistry.routeTool("code_summarizer", {}, "C:/repo");
  assert.ok(summaryResult.ok);
  assert.match(summaryResult.content[0] ?? "", /REST API/);

  const depResult = await toolRegistry.routeTool("dependency_analyzer", {}, "C:/repo");
  assert.ok(depResult.ok);
  assert.match(depResult.content[0] ?? "", /fastapi/);

  const wfResult = await toolRegistry.routeTool("workflow_executor", {}, "C:/repo");
  assert.ok(wfResult.ok);
  assert.match(wfResult.content[0] ?? "", /3 steps/);
});

// ---------------------------------------------------------------------------
// Test 6 — Multi-tool reasoning
// ---------------------------------------------------------------------------
test("Test 6 — Agent chains code_summarizer then dependency_analyzer for a compound query", async () => {
  const toolRegistry = new ToolProviderRegistry();
  toolRegistry.registerProvider(makeProvider("code-summarizer-provider", [
    makeDef("code_summarizer", "Summarizes the purpose and structure of a code file.", "analysis"),
  ], () => ({
    name: "code_summarizer",
    ok: true,
    content: ["This project is a VS Code extension that wraps a Python token-budget backend."],
  })));
  toolRegistry.registerProvider(makeProvider("dep-analyzer-provider", [
    makeDef("dependency_analyzer", "Lists all direct dependencies of a module.", "analysis"),
  ], () => ({
    name: "dependency_analyzer",
    ok: true,
    content: ["Risks: 2 high-severity CVEs found in httpx@0.23.0 and pydantic@1.9.0"],
  })));

  // LLM: pick tool A, then tool B, then synthesize.
  const provider = new ScriptedProvider([
    '{"mode":"tool","toolName":"code_summarizer","arguments":{},"reasoning":"First summarize the project structure."}',
    '{"mode":"tool","toolName":"dependency_analyzer","arguments":{},"reasoning":"Now analyze risks from dependencies."}',
    "The project is a VS Code extension wrapping a Python backend. Risk: 2 high-severity CVEs in httpx and pydantic.",
  ]);
  const modelRegistry = new ModelProviderRegistry([provider], "copilot");

  const calledTools: string[] = [];
  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: modelRegistry,
    listTools: () => toolRegistry.listAllTools(),
    toolExecutor: {
      invokeTool: async (_root, name, args) => {
        calledTools.push(name);
        return toolRegistry.routeTool(name, args, _root);
      },
    },
  });

  const result = await runtime.runPreview({
    query: "Analyze this project and summarize its structure and risks",
    maxToolSteps: 3,
  });

  assert.deepEqual(calledTools, ["code_summarizer", "dependency_analyzer"]);
  assert.equal(result.toolResults?.length, 2);
  assert.match(result.answer, /CVE/i);
  assert.match(result.answer, /VS Code extension/i);
});

// ---------------------------------------------------------------------------
// Test 7 — Tool discovery at scale (10+ tools)
// ---------------------------------------------------------------------------
test("Test 7 — All 12 registered tools appear in manifest; correct tool selected by the model", async () => {
  const toolDefs: ToolDefinition[] = [
    makeDef("file_reader", "Reads a file from disk and returns its content.", "fs"),
    makeDef("file_writer", "Writes content to a file on disk.", "fs"),
    makeDef("symbol_finder", "Finds where a code symbol is defined in the workspace.", "code"),
    makeDef("symbol_renamer", "Renames a code symbol across the workspace.", "code"),
    makeDef("test_runner", "Runs the project's test suite and returns results.", "testing"),
    makeDef("lint_checker", "Runs the linter and returns lint violations.", "quality"),
    makeDef("git_log", "Returns the recent git commit history.", "vcs"),
    makeDef("git_blame", "Shows who last changed each line of a file.", "vcs"),
    makeDef("api_caller", "Makes an HTTP request to an external API.", "network"),
    makeDef("env_inspector", "Inspects environment variables and runtime config.", "ops"),
    makeDef("code_summarizer", "Summarizes the purpose and structure of a code module.", "analysis"),
    makeDef("dependency_analyzer", "Lists all direct and transitive dependencies.", "analysis"),
  ];

  const toolRegistry = new ToolProviderRegistry();
  for (const def of toolDefs) {
    toolRegistry.registerProvider(makeProvider(`${def.name}-provider`, [def], (_name) => ({
      name: _name,
      ok: true,
      content: [`${_name} output`],
    })));
  }

  const allTools = await toolRegistry.listAllTools();
  assert.equal(allTools.length, 12, "All 12 tools must be discoverable");

  // Build manifest as the runtime would.
  const manifest = allTools.map((t) => `- ${t.name} [${t.category}]: ${t.description}`).join("\n");
  for (const def of toolDefs) {
    assert.ok(manifest.includes(def.name), `${def.name} must appear in manifest`);
  }

  // Model selects symbol_finder for a locate-symbol query.
  const provider = new ScriptedProvider([
    '{"mode":"tool","toolName":"symbol_finder","arguments":{"name":"MyClass"},"reasoning":"symbol_finder is the right tool to locate a symbol definition."}',
    "MyClass is defined in src/core/MyClass.ts at line 42.",
  ]);
  const modelRegistry = new ModelProviderRegistry([provider], "copilot");

  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: modelRegistry,
    listTools: () => toolRegistry.listAllTools(),
    toolExecutor: { invokeTool: (_root, name, args) => toolRegistry.routeTool(name, args, _root) },
  });

  const result = await runtime.runPreview({ query: "Find where MyClass is defined" });
  assert.equal(result.plan.kind, "tool");
  assert.equal(result.plan.toolName, "symbol_finder");
  assert.match(result.answer, /MyClass/i);
});

// ---------------------------------------------------------------------------
// Test 8 — Tool replacement
// ---------------------------------------------------------------------------
test("Test 8 — Replacing a tool with a different name leaves the system functional", async () => {
  const toolRegistry = new ToolProviderRegistry();

  // Register original tool.
  toolRegistry.registerProvider(makeProvider("old-summarizer-provider", [
    makeDef("project_summarizer", "Returns a summary of the whole project.", "analysis"),
  ], () => ({
    name: "project_summarizer",
    ok: true,
    content: ["Project summary v1"],
  })));

  // Verify it is present.
  let tools = await toolRegistry.listAllTools();
  assert.ok(tools.some((t) => t.name === "project_summarizer"));

  // Remove the old provider and register a replacement with a different name.
  toolRegistry.unregisterProvider("old-summarizer-provider");
  toolRegistry.registerProvider(makeProvider("new-overview-provider", [
    makeDef("project_overview", "Generates a high-level overview of the project.", "analysis"),
  ], () => ({
    name: "project_overview",
    ok: true,
    content: ["Project overview v2"],
  })));

  // Old tool is gone; new tool is present.
  tools = await toolRegistry.listAllTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "project_overview");
  assert.ok(!tools.some((t) => t.name === "project_summarizer"), "Old tool must be gone");

  // Runtime uses the new tool without any code changes.
  const provider = new ScriptedProvider([
    '{"mode":"tool","toolName":"project_overview","arguments":{},"reasoning":"project_overview is now the available tool."}',
    "The project overview v2 was returned successfully.",
  ]);
  const modelRegistry = new ModelProviderRegistry([provider], "copilot");

  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: modelRegistry,
    listTools: () => toolRegistry.listAllTools(),
    toolExecutor: { invokeTool: (_root, name, args) => toolRegistry.routeTool(name, args, _root) },
  });

  const result = await runtime.runPreview({ query: "Give me an overview of this project" });

  assert.equal(result.plan.kind, "tool");
  assert.equal(result.plan.toolName, "project_overview");
  assert.ok(result.toolResult?.ok);
  assert.match(result.answer, /overview v2/i);
});
