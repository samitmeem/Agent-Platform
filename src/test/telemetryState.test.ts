import test from "node:test";
import assert from "node:assert/strict";

import type { StoredPreviewRun } from "../state/sessionStore";
import { TelemetryState } from "../state/telemetryState";

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

test("TelemetryState records run outcomes and provider usage", async () => {
  const state = new TelemetryState(new FakeMemento() as never);

  await state.recordRunEvent({
    mode: "preview",
    source: "chat",
    outcome: "completed",
    durationMs: 120,
    providerKind: "copilot",
    toolCallCount: 2,
    finishedAt: "2026-04-24T12:00:00.000Z",
  });
  await state.recordRunEvent({
    mode: "action",
    source: "command",
    outcome: "failed",
    durationMs: 80,
    providerKind: "local",
    toolCallCount: 1,
    finishedAt: "2026-04-24T12:01:00.000Z",
    errorMessage: "backend unavailable",
  });

  const snapshot = state.getSnapshot();
  assert.equal(snapshot.totalRuns, 2);
  assert.equal(snapshot.previewRuns, 1);
  assert.equal(snapshot.actionRuns, 1);
  assert.equal(snapshot.chatRuns, 1);
  assert.equal(snapshot.commandRuns, 1);
  assert.equal(snapshot.completedRuns, 1);
  assert.equal(snapshot.failedRuns, 1);
  assert.equal(snapshot.totalToolCalls, 3);
  assert.equal(snapshot.providerUsage.copilot, 1);
  assert.equal(snapshot.providerUsage.local, 1);
  assert.match(snapshot.lastFailureMessage ?? "", /backend unavailable/i);
});

test("TelemetryState records backend restarts and recovery events", async () => {
  const state = new TelemetryState(new FakeMemento() as never);

  await state.recordBackendRestart();
  await state.recordRecoveryEvent("Recovered interrupted action run");

  const snapshot = state.getSnapshot();
  assert.equal(snapshot.backendRestarts, 1);
  assert.equal(snapshot.recoveryEvents, 1);
  assert.match(snapshot.lastRecoveryMessage ?? "", /interrupted action run/i);
});

test("TelemetryState derives failure notes from failed recorded runs", async () => {
  const state = new TelemetryState(new FakeMemento() as never);

  const run: StoredPreviewRun = {
    id: "failed-run",
    query: "Apply the selected text to greet and validate",
    answer: "Validation failed and rollback completed.",
    createdAt: "2026-04-24T12:02:00.000Z",
    source: "command",
    outcome: "failed",
    result: {
      query: "Apply the selected text to greet and validate",
      mode: "action",
      plan: {
        kind: "tool",
        toolName: "apply_symbol_change_and_validate",
        arguments: { symbol_name: "greet" },
        reasoning: "Apply the selected replacement.",
        source: "heuristic",
      },
      answer: "Validation failed and rollback completed.",
      toolResults: [
        {
          name: "apply_symbol_change_and_validate",
          ok: true,
          content: [JSON.stringify({ ok: false, summary: { headline: "Validation failed for greet" } })],
          error: null,
        },
      ],
      trace: [],
    },
  };

  await state.recordRun(run);

  const snapshot = state.getSnapshot();
  assert.equal(snapshot.failedRuns, 1);
  assert.match(snapshot.lastFailureMessage ?? "", /validation failed for greet/i);
});
