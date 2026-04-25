import test from "node:test";
import assert from "node:assert/strict";

import { buildObservabilityHtml } from "../views/observabilityRenderer";
import { SessionStore } from "../state/sessionStore";

test("buildObservabilityHtml includes telemetry, run details, and checkpoint summary", () => {
  const store = new SessionStore();
  store.savePreviewRun({
    id: "obs-run-1",
    query: "Run impacted tests for TokenSaviorService",
    answer: "2 impacted tests passed.",
    createdAt: "2026-04-24T16:00:00.000Z",
    startedAt: "2026-04-24T15:59:58.000Z",
    durationMs: 2000,
    source: "command",
    outcome: "completed",
    result: {
      query: "Run impacted tests for TokenSaviorService",
      mode: "action",
      plan: {
        kind: "tool",
        toolName: "run_impacted_tests",
        arguments: { symbol_names: ["TokenSaviorService"] },
        reasoning: "Validate the changed symbol.",
        source: "heuristic",
      },
      answer: "2 impacted tests passed.",
      providerKind: "local",
      trace: [],
    },
  });

  const html = buildObservabilityHtml(store, {
    totalRuns: 2,
    previewRuns: 1,
    actionRuns: 1,
    chatRuns: 0,
    commandRuns: 2,
    completedRuns: 2,
    failedRuns: 0,
    cancelledRuns: 0,
    backendRestarts: 1,
    recoveryEvents: 1,
    totalToolCalls: 2,
    totalDurationMs: 2800,
    averageDurationMs: 1400,
    providerUsage: { local: 1, copilot: 1 },
    lastRunAt: "2026-04-24T16:00:00.000Z",
    lastRecoveryMessage: "Recovered interrupted action run",
    lastFailureMessage: "Backend timeout",
  }, "obs-run-1", {
    checkpointId: "ckpt-obs-1",
    createdAt: "2026-04-24T15:59:59.000Z",
    filePath: "src/token_savior/service_api/service.py",
  });

  assert.match(html, /Token Savior Observability/);
  assert.match(html, /Action runs/);
  assert.match(html, /Run impacted tests for TokenSaviorService/);
  assert.match(html, /ckpt-obs-1/);
  assert.match(html, /local/);
  assert.match(html, /Recovered interrupted action run/);
  assert.match(html, /Backend timeout/);
});