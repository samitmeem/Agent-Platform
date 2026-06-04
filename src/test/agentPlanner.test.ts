import test from "node:test";
import assert from "node:assert/strict";

import type {
  ModelProvider,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
} from "../providers/base";
import type { ServiceToolResult } from "../backend/protocol";
import { AgentPlanner, createHeuristicPlan, extractFirstJsonObject } from "../agent/planner";

class FakeProvider implements ModelProvider {
  public readonly kind = "copilot" as const;
  public readonly displayName = "Fake Provider";

  public constructor(private readonly responseText: string) {}

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
    return {
      provider: this.kind,
      text: this.responseText,
      chunks: [this.responseText],
    };
  }
}

test("createHeuristicPlan chooses project summary for repo overview requests", () => {
  const plan = createHeuristicPlan("What is this project about?");

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "get_project_summary");
  assert.equal(plan.source, "heuristic");
});

test("createHeuristicPlan chooses dependency lookup for dependency questions", () => {
  const plan = createHeuristicPlan("What does TokenSaviorService depend on?");

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "get_dependencies");
  assert.equal(plan.arguments.name, "TokenSaviorService");
});

test("createHeuristicPlan chooses change impact for blast-radius questions", () => {
  const plan = createHeuristicPlan("What is the impact of changing TokenSaviorService?");

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "get_change_impact");
  assert.equal(plan.arguments.name, "TokenSaviorService");
});

test("createHeuristicPlan chooses apply-and-validate in action mode", () => {
  const plan = createHeuristicPlan(
    "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
    "def invoke_tool(self, name: str) -> str:\n    return name",
    "action",
    "src/token_savior/service_api/service.py",
  );

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "apply_symbol_change_and_validate");
  assert.equal(plan.arguments.symbol_name, "TokenSaviorService.invoke_tool");
  assert.equal(plan.arguments.file_path, "src/token_savior/service_api/service.py");
  assert.equal(plan.arguments.rollback_on_failure, true);
});

test("createHeuristicPlan chooses impacted tests in action mode", () => {
  const plan = createHeuristicPlan(
    "Run impacted tests for TokenSaviorService",
    undefined,
    "action",
    "src/token_savior/service_api/service.py",
  );

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "run_impacted_tests");
  assert.deepEqual(plan.arguments.symbol_names, ["TokenSaviorService"]);
});

test("extractFirstJsonObject finds fenced JSON", () => {
  const text = "Here you go:\n```json\n{\"mode\":\"direct\",\"response\":\"hello\"}\n```";

  assert.equal(extractFirstJsonObject(text), '{"mode":"direct","response":"hello"}');
});

test("AgentPlanner uses model JSON when valid", async () => {
  const planner = new AgentPlanner();
  const provider = new FakeProvider('{"mode":"tool","toolName":"find_symbol","arguments":{"name":"TokenSaviorService"},"reasoning":"Locate the symbol directly."}');

  const plan = await planner.plan({
    query: "Find symbol TokenSaviorService",
    provider,
  });

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "find_symbol");
  assert.equal(plan.arguments.name, "TokenSaviorService");
  assert.equal(plan.source, "model");
});

test("AgentPlanner accepts model full-context plans", async () => {
  const planner = new AgentPlanner();
  const provider = new FakeProvider('{"mode":"tool","toolName":"get_full_context","arguments":{"name":"TokenSaviorService"},"reasoning":"Need the full symbol context."}');

  const plan = await planner.plan({
    query: "Analyze TokenSaviorService with full context",
    provider,
  });

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "get_full_context");
  assert.equal(plan.arguments.name, "TokenSaviorService");
  assert.equal(plan.source, "model");
});

test("AgentPlanner falls back to heuristics when model output is unusable", async () => {
  const planner = new AgentPlanner();
  const provider = new FakeProvider("definitely not json");

  const plan = await planner.plan({
    query: "Search memory for service api transport",
    provider,
  });

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "memory_search");
  assert.equal(plan.source, "heuristic");
});

test("AgentPlanner creates a follow-up dependency step heuristically", async () => {
  const planner = new AgentPlanner();
  const previousToolResults: ServiceToolResult[] = [
    {
      name: "find_symbol",
      ok: true,
      content: [JSON.stringify([{ file: "src/service.py", line: 12 }])],
    },
  ];

  const plan = await planner.planFollowUp({
    query: "Find TokenSaviorService and explain its dependencies",
    previousPlans: [
      {
        kind: "tool",
        toolName: "find_symbol",
        arguments: { name: "TokenSaviorService" },
        reasoning: "Locate the symbol first.",
        source: "heuristic",
      },
    ],
    previousToolResults,
  });

  assert.equal(plan?.kind, "tool");
  assert.equal(plan?.toolName, "get_dependencies");
  assert.equal(plan?.arguments.name, "TokenSaviorService");
});

test("AgentPlanner creates a validation follow-up after a successful apply action", async () => {
  const planner = new AgentPlanner();

  const plan = await planner.planFollowUp({
    query: "Apply the selected text to TokenSaviorService.invoke_tool and validate it",
    selectedText: "def invoke_tool(self, name: str) -> str:\n    return name",
    mode: "action",
    activeFilePath: "src/token_savior/service_api/service.py",
    previousPlans: [
      {
        kind: "tool",
        toolName: "apply_symbol_change_and_validate",
        arguments: {
          symbol_name: "TokenSaviorService.invoke_tool",
        },
        reasoning: "Apply the requested change first.",
        source: "heuristic",
      },
    ],
    previousToolResults: [
      {
        name: "apply_symbol_change_and_validate",
        ok: true,
        content: [JSON.stringify({ checkpoint_id: "ckpt-1", validated: true })],
      },
    ],
  });

  assert.equal(plan?.kind, "tool");
  assert.equal(plan?.toolName, "run_impacted_tests");
  assert.deepEqual(plan?.arguments.symbol_names, ["TokenSaviorService.invoke_tool"]);
});

test("AgentPlanner accepts model action plans in action mode", async () => {
  const planner = new AgentPlanner();
  const provider = new FakeProvider('{"mode":"tool","toolName":"run_impacted_tests","arguments":{"symbol_names":["TokenSaviorService"]},"reasoning":"Validate the changed symbol."}');

  const plan = await planner.plan({
    query: "Run impacted tests for TokenSaviorService",
    mode: "action",
    provider,
    activeFilePath: "src/token_savior/service_api/service.py",
  });

  assert.equal(plan.kind, "tool");
  assert.equal(plan.toolName, "run_impacted_tests");
  assert.deepEqual(plan.arguments.symbol_names, ["TokenSaviorService"]);
  assert.equal(plan.source, "model");
});
