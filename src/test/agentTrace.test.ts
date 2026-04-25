import test from "node:test";
import assert from "node:assert/strict";

import { formatTraceEntries, traceEntry } from "../agent/trace";

test("formatTraceEntries renders numbered trace lines", () => {
  const output = formatTraceEntries([
    traceEntry(1, "provider", "Selected provider", { kind: "copilot" }),
    traceEntry(2, "plan", "Generated plan", { kind: "tool" }),
  ]);

  assert.match(output, /^1\. \[provider\] Selected provider/);
  assert.match(output, /2\. \[plan\] Generated plan/);
  assert.match(output, /"kind":"copilot"/);
});
