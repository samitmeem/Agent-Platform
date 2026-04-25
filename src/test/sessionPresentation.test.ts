import test from "node:test";
import assert from "node:assert/strict";

import { traceEntry } from "../agent/trace";
import {
  formatStoredPreviewRunBody,
  toPreviewRunListItem,
} from "../state/sessionPresentation";

test("formatStoredPreviewRunBody renders tool-backed preview details", () => {
  const output = formatStoredPreviewRunBody({
    id: "run-42",
    query: "What is this project about?",
    answer: "It is a VS Code extension backed by a Python service.",
    createdAt: "2026-04-23T12:00:00.000Z",
    result: {
      query: "What is this project about?",
      plan: {
        kind: "tool",
        toolName: "get_project_summary",
        arguments: {},
        reasoning: "Need repository context.",
        source: "model",
      },
      answer: "It is a VS Code extension backed by a Python service.",
      providerKind: "copilot",
      toolResult: {
        name: "get_project_summary",
        ok: true,
        content: ["raw summary"],
      },
      trace: [
        traceEntry(1, "provider", "Resolved provider."),
        traceEntry(2, "plan", "Created tool plan."),
      ],
    },
  });

  assert.match(output, /Run ID: run-42/);
  assert.match(output, /Tool: get_project_summary/);
  assert.match(output, /Provider: copilot/);
  assert.match(output, /Trace:/);
  assert.match(output, /Raw tool result:/);
});

test("toPreviewRunListItem creates compact quick-pick metadata", () => {
  const item = toPreviewRunListItem({
    id: "run-99",
    query: "Explain the preview runtime and why it uses bounded tool execution for safety in this extension architecture.",
    answer: "A deliberately long answer that should still become a compact detail line for the quick pick without turning into a wall of text in the picker UI.",
    createdAt: "2026-04-23T12:05:00.000Z",
    result: {
      query: "Explain the preview runtime",
      plan: {
        kind: "direct",
        response: "bounded runtime",
        reasoning: "overview",
        source: "heuristic",
      },
      answer: "bounded runtime",
      trace: [],
    },
  });

  assert.equal(item.runId, "run-99");
  assert.match(item.description, /direct/i);
  assert.match(item.description, /no provider/i);
  assert.ok(item.label.length <= 80);
  assert.ok(item.detail.length <= 120);
});