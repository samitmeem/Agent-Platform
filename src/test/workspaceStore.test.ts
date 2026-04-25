import test from "node:test";
import assert from "node:assert/strict";

import { SessionStore } from "../state/sessionStore";
import { WorkspaceStore } from "../state/workspaceStore";

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

test("WorkspaceStore hydrates and persists preview runs", async () => {
  const memento = new FakeMemento();
  const workspaceStore = new WorkspaceStore(memento as never);
  const sessionStore = new SessionStore(5);

  sessionStore.savePreviewRun({
    id: "run-1",
    query: "What is this project about?",
    answer: "A backend plus VS Code extension.",
    createdAt: "2026-04-24T00:00:00.000Z",
    result: {
      query: "What is this project about?",
      plan: {
        kind: "direct",
        response: "A backend plus VS Code extension.",
        reasoning: "summary",
        source: "heuristic",
      },
      answer: "A backend plus VS Code extension.",
      trace: [],
    },
  });

  await workspaceStore.persistPreviewRuns(sessionStore.listPreviewRuns());

  const restoredStore = new SessionStore(5);
  workspaceStore.hydrateSessionStore(restoredStore);

  assert.equal(restoredStore.getLastPreviewRun()?.id, "run-1");
});

test("WorkspaceStore remembers the last checkpoint record", async () => {
  const memento = new FakeMemento();
  const workspaceStore = new WorkspaceStore(memento as never);

  await workspaceStore.saveLastCheckpoint({
    checkpointId: "ckpt-1",
    createdAt: "2026-04-24T00:00:00.000Z",
    filePath: "src/service.py",
  });

  assert.equal(workspaceStore.getLastCheckpoint()?.checkpointId, "ckpt-1");

  await workspaceStore.clearLastCheckpoint();
  assert.equal(workspaceStore.getLastCheckpoint(), undefined);
});

test("WorkspaceStore remembers and clears the active run record", async () => {
  const memento = new FakeMemento();
  const workspaceStore = new WorkspaceStore(memento as never);

  await workspaceStore.saveActiveRun({
    id: "run-active",
    query: "Run impacted tests for TokenSaviorService",
    mode: "action",
    source: "command",
    startedAt: "2026-04-24T12:00:00.000Z",
    activeFilePath: "src/token_savior/service_api/service.py",
  });

  assert.equal(workspaceStore.getActiveRun()?.id, "run-active");
  await workspaceStore.clearActiveRun();
  assert.equal(workspaceStore.getActiveRun(), undefined);
});
