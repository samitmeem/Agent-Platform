import test from "node:test";
import assert from "node:assert/strict";

import { LocalModelProvider } from "../providers/localProvider";

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("LocalModelProvider reports availability for an Ollama model", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ models: [{ name: "llama3.1:8b" }] }), { status: 200 })) as typeof fetch;
  const provider = new LocalModelProvider("Local Model", {
    endpoint: "http://127.0.0.1:11434",
    modelName: "llama3.1:8b",
    apiFormat: "ollama",
  });

  const availability = await provider.availability();

  assert.equal(availability.status, "available");
  assert.equal(availability.modelId, "llama3.1:8b");
});

test("LocalModelProvider completes against an OpenAI-compatible endpoint", async () => {
  globalThis.fetch = (async (_input, init) => {
    if (!init?.method) {
      return new Response(JSON.stringify({ data: [{ id: "local-model" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: "Local answer" } }] }), { status: 200 });
  }) as typeof fetch;

  const provider = new LocalModelProvider("Local Model", {
    endpoint: "http://127.0.0.1:1234/v1",
    modelName: "local-model",
    apiFormat: "openai",
    apiKey: "secret",
  });

  const result = await provider.complete({
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(result.text, "Local answer");
  assert.equal(result.modelId, "local-model");
});
