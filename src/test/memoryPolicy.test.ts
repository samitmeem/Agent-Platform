import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMemoryPayloadFromRun,
  evaluatePreviewRunForAutoSave,
} from "../policies/memoryPolicy";
import type { StoredPreviewRun } from "../state/sessionStore";

function createRun(overrides: Partial<StoredPreviewRun> = {}): StoredPreviewRun {
  return {
    id: "run-1",
    query: "Explain the service layer and dependency graph",
    answer: "The service layer exposes typed capabilities and relies on tool dispatch plus schemas.",
    createdAt: "2026-04-24T10:00:00.000Z",
    source: "command",
    activeFilePath: "src/token_savior/service_api/service.py",
    result: {
      query: "Explain the service layer and dependency graph",
      plan: {
        kind: "tool",
        toolName: "find_symbol",
        arguments: { name: "TokenSaviorService" },
        reasoning: "Need to locate the symbol first.",
        source: "model",
      },
      plans: [
        {
          kind: "tool",
          toolName: "find_symbol",
          arguments: { name: "TokenSaviorService" },
          reasoning: "Locate symbol",
          source: "model",
        },
        {
          kind: "tool",
          toolName: "get_dependencies",
          arguments: { name: "TokenSaviorService" },
          reasoning: "Inspect dependencies",
          source: "model",
        },
      ],
      answer: "The service layer exposes typed capabilities and relies on tool dispatch plus schemas.",
      providerKind: "copilot",
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
    },
    ...overrides,
  };
}

test("evaluatePreviewRunForAutoSave skips direct-only runs", () => {
  const decision = evaluatePreviewRunForAutoSave(createRun({
    result: {
      query: "hi",
      plan: {
        kind: "direct",
        response: "hello",
        reasoning: "small talk",
        source: "heuristic",
      },
      answer: "hello",
      trace: [],
    },
  }));

  assert.equal(decision.shouldSave, false);
  assert.match(decision.reason, /direct-only/i);
});

test("evaluatePreviewRunForAutoSave saves multi-step investigations", () => {
  const decision = evaluatePreviewRunForAutoSave(createRun());

  assert.equal(decision.shouldSave, true);
  assert.match(decision.reason, /multi-step/i);
});

test("buildMemoryPayloadFromRun includes tool sequence and context", () => {
  const payload = buildMemoryPayloadFromRun(createRun());

  assert.equal(payload.type, "decision");
  assert.match(payload.content, /Tool sequence: find_symbol -> get_dependencies/);
  assert.match(payload.content, /Active file: src\/token_savior\/service_api\/service.py/);
  assert.ok(payload.tags.includes("multi-step"));
  assert.ok(payload.tags.includes("find_symbol"));
  assert.ok(payload.context);
  assert.ok(payload.narrative);
  assert.ok(payload.facts);
});
