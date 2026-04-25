import test from "node:test";
import assert from "node:assert/strict";

import { recordPreviewRun } from "../agent/runRecorder";
import { AgentRuntime } from "../agent/runtime";
import type { ServiceToolResult } from "../backend/protocol";
import type {
  ModelProvider,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
} from "../providers/base";
import { ModelProviderRegistry } from "../providers/registry";
import type { ApprovalSettings } from "../policies/approvalPolicy";
import { SessionStore } from "../state/sessionStore";
import { TelemetryState } from "../state/telemetryState";

class FakeProvider implements ModelProvider {
  public readonly kind = "copilot" as const;
  public readonly displayName = "Golden Trace Provider";
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

class FakeMemento {
  private readonly values = new Map<string, unknown>();

  public get<T>(key: string, defaultValue?: T): T {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T;
  }

  public update(key: string, value: unknown): Thenable<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

const approvalSettings: ApprovalSettings = {
  editMode: "ask",
  testMode: "allow-trusted",
  commandMode: "allow-trusted",
  destructiveMode: "ask",
  autoSaveProjectMemory: false,
  persistRunHistory: true,
};

test("preview lifecycle preserves the golden trace and telemetry snapshot", async () => {
  const provider = new FakeProvider([
    '{"mode":"tool","toolName":"get_project_summary","arguments":{},"reasoning":"Need the repo summary."}',
    "The project is a Python backend with a VS Code extension orchestrator.",
  ]);
  const registry = new ModelProviderRegistry([provider], "copilot");
  const sessionStore = new SessionStore();
  const telemetryState = new TelemetryState(new FakeMemento() as never);
  const toolResult: ServiceToolResult = {
    name: "get_project_summary",
    ok: true,
    content: ["Python backend + VS Code extension"],
  };

  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: registry,
    toolExecutor: {
      invokeTool: async (_root, name) => {
        assert.equal(name, "get_project_summary");
        return toolResult;
      },
    },
  });

  const result = await runtime.runPreview({
    query: "What is this project about?",
    maxToolSteps: 1,
  });
  const recorded = await recordPreviewRun({
    gateway: {
      invokeTool: async () => {
        throw new Error("memory_save should not be called when auto-save is disabled");
      },
    } as never,
    sessionStore,
    workspaceRoot: "C:/repo",
    getApprovalSettings: () => approvalSettings,
  }, {
    id: "golden-preview",
    query: result.query,
    result,
    source: "command",
    startedAt: "2026-04-24T12:00:00.000Z",
    durationMs: 250,
    outcome: "completed",
    createdAt: "2026-04-24T12:00:00.250Z",
  });
  await telemetryState.recordRun(recorded.run);

  assert.deepEqual(result.trace.map((entry) => entry.phase), ["provider", "plan", "tool", "tool", "control", "answer"]);
  assert.equal(sessionStore.getLastPreviewRun()?.id, "golden-preview");
  assert.equal(sessionStore.getLastPreviewRun()?.durationMs, 250);
  assert.equal(sessionStore.getLastPreviewRun()?.outcome, "completed");

  const snapshot = telemetryState.getSnapshot();
  assert.equal(snapshot.totalRuns, 1);
  assert.equal(snapshot.previewRuns, 1);
  assert.equal(snapshot.completedRuns, 1);
  assert.equal(snapshot.providerUsage.copilot, 1);
  assert.equal(snapshot.totalToolCalls, 1);
});

test("action lifecycle preserves the bounded-action golden trace and telemetry snapshot", async () => {
  const registry = new ModelProviderRegistry([], "copilot");
  const sessionStore = new SessionStore();
  const telemetryState = new TelemetryState(new FakeMemento() as never);

  const runtime = new AgentRuntime({
    workspaceRoot: "C:/repo",
    providerRegistry: registry,
    toolExecutor: {
      invokeTool: async (_root, name, argumentsPayload) => {
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
  const recorded = await recordPreviewRun({
    gateway: {
      invokeTool: async () => {
        throw new Error("memory_save should not be called when auto-save is disabled");
      },
    } as never,
    sessionStore,
    workspaceRoot: "C:/repo",
    getApprovalSettings: () => approvalSettings,
  }, {
    id: "golden-action",
    query: result.query,
    result,
    source: "command",
    startedAt: "2026-04-24T12:05:00.000Z",
    durationMs: 180,
    outcome: "completed",
    createdAt: "2026-04-24T12:05:00.180Z",
  });
  await telemetryState.recordRun(recorded.run);

  assert.equal(result.mode, "action");
  assert.deepEqual(result.trace.map((entry) => entry.phase), ["control", "provider", "plan", "tool", "tool", "control", "answer"]);
  assert.equal(sessionStore.getLastPreviewRun()?.id, "golden-action");
  assert.equal(sessionStore.getLastPreviewRun()?.outcome, "completed");

  const snapshot = telemetryState.getSnapshot();
  assert.equal(snapshot.totalRuns, 1);
  assert.equal(snapshot.actionRuns, 1);
  assert.equal(snapshot.completedRuns, 1);
  assert.equal(snapshot.totalToolCalls, 1);
  assert.equal(snapshot.providerUsage.copilot ?? 0, 0);
});
