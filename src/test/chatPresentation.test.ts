import test from "node:test";
import assert from "node:assert/strict";

import { traceEntry } from "../agent/trace";
import {
  formatChatParticipantResult,
  resolveChatParticipantPrompt,
} from "../chat/presentation";

test("resolveChatParticipantPrompt expands slash commands into safe prompts", () => {
  assert.equal(resolveChatParticipantPrompt("", "summary"), "What is this project about?");
  assert.equal(
    resolveChatParticipantPrompt("TokenSaviorService", "symbol"),
    "Analyze the symbol TokenSaviorService with full context.",
  );
  assert.equal(
    resolveChatParticipantPrompt("", "dependencies", "TokenSaviorService"),
    "What does TokenSaviorService depend on?",
  );
});

test("formatChatParticipantResult renders answer and trace markdown", () => {
  const markdown = formatChatParticipantResult({
    query: "What is this project about?",
    plan: {
      kind: "tool",
      toolName: "get_project_summary",
      arguments: {},
      reasoning: "Need a summary.",
      source: "heuristic",
    },
    answer: "It is a VS Code extension backed by a Python service.",
    providerKind: "copilot",
    trace: [
      traceEntry(1, "provider", "Resolved model provider."),
      traceEntry(2, "tool", "Invoked summary tool."),
    ],
  });

  assert.match(markdown, /### Run details/);
  assert.match(markdown, /Tool: get_project_summary/);
  assert.match(markdown, /### Trace/);
  assert.match(markdown, /Resolved model provider/);
});
