import test from "node:test";
import assert from "node:assert/strict";

import { AgentMemoryBridge } from "../agent/memoryBridge";
import { SessionStore } from "../state/sessionStore";

test("AgentMemoryBridge builds bounded recent-run and memory context", async () => {
  const store = new SessionStore(3);
  store.savePreviewRun({
    id: "run-1",
    query: "Find symbol TokenSaviorService",
    answer: "Located in service.py",
    createdAt: "2026-04-23T12:00:00.000Z",
    result: {
      query: "Find symbol TokenSaviorService",
      plan: {
        kind: "direct",
        response: "Located in service.py",
        reasoning: "previous run",
        source: "heuristic",
      },
      answer: "Located in service.py",
      trace: [],
    },
  });

  const bridge = new AgentMemoryBridge({
    workspaceRoot: "C:/repo",
    sessionStore: store,
    toolExecutor: {
      invokeTool: async (_root, name) => {
        if (name === "memory_session_history") {
          return {
            name,
            ok: true,
            content: ["Session rollup"],
          };
        }

        return {
          name,
          ok: true,
          content: ["Memory hit"],
        };
      },
    },
  });

  const context = await bridge.buildContext("Search project memory for service api decisions");

  assert.equal(context.recentRuns.length, 1);
  assert.match(context.recentRuns[0] ?? "", /Find symbol TokenSaviorService/);
  assert.equal(context.sessionHistory, "Session rollup");
  assert.equal(context.projectMemory, "Memory hit");
});

test("AgentMemoryBridge skips project memory search for very short queries", async () => {
  const store = new SessionStore(1);
  const calledTools: string[] = [];
  const bridge = new AgentMemoryBridge({
    workspaceRoot: "C:/repo",
    sessionStore: store,
    toolExecutor: {
      invokeTool: async (_root, name) => {
        calledTools.push(name);
        return {
          name,
          ok: true,
          content: ["stub"],
        };
      },
    },
  });

  const context = await bridge.buildContext("help");

  assert.deepEqual(calledTools, ["memory_session_history"]);
  assert.equal(context.projectMemory, undefined);
});
