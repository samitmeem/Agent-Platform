import test from "node:test";
import assert from "node:assert/strict";

import { SessionStore } from "../state/sessionStore";

test("SessionStore keeps the most recent preview runs first", () => {
  const store = new SessionStore(2);

  store.savePreviewRun({
    id: "1",
    query: "first",
    answer: "one",
    createdAt: "2026-04-23T00:00:00.000Z",
    result: {
      query: "first",
      plan: {
        kind: "direct",
        response: "one",
        reasoning: "first",
        source: "heuristic",
      },
      answer: "one",
      trace: [],
    },
  });
  store.savePreviewRun({
    id: "2",
    query: "second",
    answer: "two",
    createdAt: "2026-04-23T00:00:01.000Z",
    result: {
      query: "second",
      plan: {
        kind: "direct",
        response: "two",
        reasoning: "second",
        source: "heuristic",
      },
      answer: "two",
      trace: [],
    },
  });
  store.savePreviewRun({
    id: "3",
    query: "third",
    answer: "three",
    createdAt: "2026-04-23T00:00:02.000Z",
    result: {
      query: "third",
      plan: {
        kind: "direct",
        response: "three",
        reasoning: "third",
        source: "heuristic",
      },
      answer: "three",
      trace: [],
    },
  });

  assert.equal(store.listPreviewRuns().length, 2);
  assert.equal(store.getLastPreviewRun()?.id, "3");
  assert.equal(store.getPreviewRun("2")?.query, "second");
  assert.deepEqual(store.listPreviewRuns().map((run) => run.id), ["3", "2"]);
});

test("SessionStore clear removes retained preview runs", () => {
  const store = new SessionStore(3);

  store.savePreviewRun({
    id: "run-1",
    query: "history",
    answer: "kept",
    createdAt: "2026-04-23T00:00:00.000Z",
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

  store.clear();

  assert.equal(store.getLastPreviewRun(), undefined);
  assert.equal(store.getPreviewRun("run-1"), undefined);
  assert.deepEqual(store.listPreviewRuns(), []);
});

test("SessionStore notifies subscribers when preview history changes", () => {
  const store = new SessionStore(3);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  store.savePreviewRun({
    id: "run-2",
    query: "notify",
    answer: "updated",
    createdAt: "2026-04-23T00:00:01.000Z",
    result: {
      query: "notify",
      plan: {
        kind: "direct",
        response: "updated",
        reasoning: "notify",
        source: "heuristic",
      },
      answer: "updated",
      trace: [],
    },
  });
  store.clear();
  unsubscribe();
  store.savePreviewRun({
    id: "run-3",
    query: "ignored",
    answer: "ignored",
    createdAt: "2026-04-23T00:00:02.000Z",
    result: {
      query: "ignored",
      plan: {
        kind: "direct",
        response: "ignored",
        reasoning: "ignored",
        source: "heuristic",
      },
      answer: "ignored",
      trace: [],
    },
  });

  assert.equal(notifications, 2);
});
