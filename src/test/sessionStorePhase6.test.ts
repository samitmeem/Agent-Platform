import test from "node:test";
import assert from "node:assert/strict";

import { SessionStore } from "../state/sessionStore";

test("SessionStore updatePreviewRun updates stored memory status", () => {
  const store = new SessionStore(3);
  store.savePreviewRun({
    id: "run-1",
    query: "history",
    answer: "kept",
    createdAt: "2026-04-24T00:00:00.000Z",
    result: {
      query: "history",
      plan: {
        kind: "direct",
        response: "kept",
        reasoning: "history",
        source: "heuristic",
      },
      answer: "kept",
      trace: [],
    },
  });

  store.updatePreviewRun("run-1", (run) => ({
    ...run,
    memoryStatus: {
      state: "manual",
      reason: "Saved explicitly.",
      savedAt: "2026-04-24T00:01:00.000Z",
    },
  }));

  assert.equal(store.getPreviewRun("run-1")?.memoryStatus?.state, "manual");
  assert.equal(store.getPreviewRun("run-1")?.memoryStatus?.savedAt, "2026-04-24T00:01:00.000Z");
});
