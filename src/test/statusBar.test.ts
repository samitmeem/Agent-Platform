import test from "node:test";
import assert from "node:assert/strict";

import {
  getStatusBarText,
  getStatusBarTooltip,
  type BackendIndicatorState,
} from "../ui/statusPresentation";

test("getStatusBarText reflects backend state", () => {
  assert.equal(getStatusBarText({ kind: "idle" }), "$(circle-slash) Token Savior");
  assert.equal(getStatusBarText({ kind: "starting" }), "$(sync~spin) Token Savior");
  assert.equal(getStatusBarText({ kind: "ready" }), "$(check) Token Savior");
  assert.equal(getStatusBarText({ kind: "error" }), "$(error) Token Savior");
});

test("getStatusBarTooltip includes health details when ready", () => {
  const state: BackendIndicatorState = {
    kind: "ready",
    detail: "Workspace: C:/repo",
    health: {
      version: "1.0.0",
      profile: "full",
      capability_count: 10,
      project_count: 1,
    },
  };

  const tooltip = getStatusBarTooltip(state);

  assert.match(tooltip, /Ready · v1\.0\.0 · profile=full · capabilities=10/);
  assert.match(tooltip, /Workspace: C:\/repo/);
  assert.match(tooltip, /Click to ping the backend\./);
});