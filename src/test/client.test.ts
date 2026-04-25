import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import { JsonRpcServiceClient } from "../backend/client";

test("JsonRpcServiceClient sends request payload and resolves success response", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const client = new JsonRpcServiceClient(input, output);

  const responsePromise = client.request<{ ok: boolean }>("health.ping", {});
  const requestLine = output.read()?.toString("utf8") ?? await new Promise<string>((resolve) => {
    output.once("data", (chunk) => resolve(chunk.toString("utf8")));
  });
  const request = JSON.parse(requestLine.trim()) as { id: number; method: string };

  input.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: true } }) + "\n");

  const response = await responsePromise;
  assert.equal(request.method, "health.ping");
  assert.deepEqual(response, { ok: true });
  client.dispose();
});

test("JsonRpcServiceClient rejects error responses", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const client = new JsonRpcServiceClient(input, output);

  const responsePromise = client.request("tool.invoke", { name: "bad" });
  const requestLine = output.read()?.toString("utf8") ?? await new Promise<string>((resolve) => {
    output.once("data", (chunk) => resolve(chunk.toString("utf8")));
  });
  const request = JSON.parse(requestLine.trim()) as { id: number };

  input.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: "Unknown method" },
    }) + "\n",
  );

  await assert.rejects(responsePromise, /Unknown method/);
  client.dispose();
});