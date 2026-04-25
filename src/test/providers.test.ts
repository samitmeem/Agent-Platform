import test from "node:test";
import assert from "node:assert/strict";

import type {
  ModelProvider,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
  ProviderSnapshot,
} from "../providers/base";
import { chooseResolvedProvider, ModelProviderRegistry } from "../providers/registry";

class FakeProvider implements ModelProvider {
  public constructor(
    public readonly kind: "copilot" | "local",
    public readonly displayName: string,
    private readonly state: ProviderAvailability,
  ) {}

  public async availability(): Promise<ProviderAvailability> {
    return this.state;
  }

  public async capabilities(): Promise<ProviderCapabilities> {
    return {
      tools: false,
      streaming: false,
      structuredOutput: false,
    };
  }

  public async complete(_request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    throw new Error("Not implemented in fake provider");
  }
}

test("chooseResolvedProvider picks the preferred available provider", () => {
  const snapshots: ProviderSnapshot[] = [
    {
      kind: "copilot",
      displayName: "GitHub Copilot",
      preferred: true,
      availability: { status: "available", reason: "ready" },
    },
    {
      kind: "local",
      displayName: "Local Model",
      preferred: false,
      availability: { status: "unavailable", reason: "missing runtime" },
    },
  ];

  const resolved = chooseResolvedProvider(snapshots, "copilot");

  assert.equal(resolved?.kind, "copilot");
});

test("chooseResolvedProvider falls back to another available provider", () => {
  const snapshots: ProviderSnapshot[] = [
    {
      kind: "copilot",
      displayName: "GitHub Copilot",
      preferred: true,
      availability: { status: "requires-consent", reason: "consent needed" },
    },
    {
      kind: "local",
      displayName: "Local Model",
      preferred: false,
      availability: { status: "available", reason: "ready" },
    },
  ];

  const resolved = chooseResolvedProvider(snapshots, "copilot");

  assert.equal(resolved?.kind, "local");
});

test("ModelProviderRegistry returns snapshots and preferred fallback", async () => {
  const registry = new ModelProviderRegistry(
    [
      new FakeProvider("copilot", "GitHub Copilot", {
        status: "unavailable",
        reason: "quota blocked",
      }),
      new FakeProvider("local", "Local Model", {
        status: "available",
        reason: "ready",
      }),
    ],
    "copilot",
  );

  const snapshots = await registry.snapshots();
  const resolved = await registry.resolvePreferredProvider();

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0]?.preferred, true);
  assert.equal(resolved?.kind, "local");
});