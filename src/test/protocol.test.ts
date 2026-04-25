import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFirstSymbolLocation,
  formatToolResult,
  type ServiceToolResult,
} from "../backend/protocol";

test("formatToolResult joins multi-part content blocks", () => {
  const result: ServiceToolResult = {
    name: "get_project_summary",
    ok: true,
    content: ["part one", "part two"],
  };

  assert.equal(formatToolResult(result), "part one\n\npart two");
});

test("extractFirstSymbolLocation reads the first JSON symbol match", () => {
  const result: ServiceToolResult = {
    name: "find_symbol",
    ok: true,
    content: [JSON.stringify([{ file: "src/token_savior/service_api/service.py", line: 12 }])],
  };

  assert.deepEqual(extractFirstSymbolLocation(result), {
    file: "src/token_savior/service_api/service.py",
    line: 12,
  });
});

test("extractFirstSymbolLocation ignores non-JSON payloads", () => {
  const result: ServiceToolResult = {
    name: "find_symbol",
    ok: true,
    content: ["@F:src/token_savior/service_api/service.py @S:TokenSaviorService @L:12-80"],
  };

  assert.equal(extractFirstSymbolLocation(result), undefined);
});

test("extractFirstSymbolLocation reads nested location payloads", () => {
  const result: ServiceToolResult = {
    name: "get_full_context",
    ok: true,
    content: [JSON.stringify({ symbol: { file: "src/token_savior/service_api/service.py", line: 18 } })],
  };

  assert.deepEqual(extractFirstSymbolLocation(result), {
    file: "src/token_savior/service_api/service.py",
    line: 18,
  });
});