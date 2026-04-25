import test from "node:test";
import assert from "node:assert/strict";

import { traceEntry } from "../agent/trace";
import { formatStoredPreviewRunBody } from "../state/sessionPresentation";

test("formatStoredPreviewRunBody includes observability fields", () => {
  const output = formatStoredPreviewRunBody({
    id: "run-obs",
    query: "Run impacted tests for TokenSaviorService",
    answer: "2 impacted tests passed.",
    createdAt: "2026-04-24T12:00:01.000Z",
    startedAt: "2026-04-24T12:00:00.000Z",
    durationMs: 1000,
    source: "command",
    outcome: "completed",
    result: {
      query: "Run impacted tests for TokenSaviorService",
      mode: "action",
      plan: {
        kind: "tool",
        toolName: "run_impacted_tests",
        arguments: { symbol_names: ["TokenSaviorService"] },
        reasoning: "Validate the change.",
        source: "heuristic",
      },
      answer: "2 impacted tests passed.",
      trace: [traceEntry(1, "control", "Running bounded action mode.")],
    },
  });

  assert.match(output, /Started: 2026-04-24T12:00:00.000Z/);
  assert.match(output, /Duration: 1000 ms/);
  assert.match(output, /Outcome: completed/);
  assert.match(output, /Source: command/);
});
