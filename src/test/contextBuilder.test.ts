import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentContext } from "../agent/contextBuilder";

test("buildAgentContext composes selected text, file, and memory context", () => {
  const context = buildAgentContext({
    selectedText: "TokenSaviorService.invoke_tool",
    activeFilePath: "C:/repo/src/service.py",
    memoryContext: {
      recentRuns: ["Find symbol => located in service.py"],
      sessionHistory: "Session summary from the backend.",
      projectMemory: "Saved project note.",
    },
  });

  assert.match(context ?? "", /Active file: C:\/repo\/src\/service.py/);
  assert.match(context ?? "", /Selected text:/);
  assert.match(context ?? "", /Recent preview runs:/);
  assert.match(context ?? "", /Prior session history:/);
  assert.match(context ?? "", /Relevant project memory:/);
});

test("buildAgentContext returns undefined when no context exists", () => {
  assert.equal(buildAgentContext({}), undefined);
});
