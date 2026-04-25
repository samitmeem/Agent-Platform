import test from "node:test";
import assert from "node:assert/strict";

import {
  BackendGateway,
  type BackendLaunchConfigResolver,
  type BackendManagerFactory,
  type BackendManagerLike,
  type JsonRpcRequester,
} from "../backend/gateway";
import type { BackendLaunchConfig } from "../backend/processManager";
import type { ServiceHealth, ServiceToolResult } from "../backend/protocol";

class FakeClient implements JsonRpcRequester {
  public constructor(
    private readonly health: ServiceHealth,
    private readonly toolResult: ServiceToolResult,
  ) {}

  public async request<T>(method: string): Promise<T> {
    if (method === "health.ping") {
      return this.health as T;
    }

    if (method === "tool.invoke") {
      return this.toolResult as T;
    }

    throw new Error(`Unexpected method: ${method}`);
  }
}

test("BackendGateway reuses a manager for the same workspace/config", async () => {
  const health: ServiceHealth = {
    version: "1.0.0",
    profile: "full",
    capability_count: 10,
    project_count: 1,
  };
  const result: ServiceToolResult = {
    name: "get_project_summary",
    ok: true,
    content: ["summary"],
  };
  const configs: BackendLaunchConfig[] = [];
  let factoryCalls = 0;
  let stopCalls = 0;

  const resolver: BackendLaunchConfigResolver = (workspaceRoot) => ({
    workspaceRoot,
    configuredPythonPath: "python",
    serviceModule: "token_savior.service_api.server",
  });
  const factory: BackendManagerFactory = (config) => {
    configs.push(config);
    factoryCalls += 1;
    const manager: BackendManagerLike = {
      start: async () => new FakeClient(health, result),
      stop: async () => {
        stopCalls += 1;
      },
    };
    return manager;
  };

  const gateway = new BackendGateway(resolver, factory);

  const ping = await gateway.ping("C:/repo");
  const tool = await gateway.invokeTool("C:/repo", "get_project_summary");

  assert.equal(factoryCalls, 1);
  assert.equal(stopCalls, 0);
  assert.equal(configs.length, 1);
  assert.equal(ping.version, "1.0.0");
  assert.equal(tool.ok, true);
  assert.equal(gateway.getLastHealth()?.version, "1.0.0");
});

test("BackendGateway restart stops the current manager and creates a new one", async () => {
  const health: ServiceHealth = {
    version: "1.0.0",
    profile: "full",
    capability_count: 10,
    project_count: 1,
  };
  const result: ServiceToolResult = {
    name: "get_project_summary",
    ok: true,
    content: ["summary"],
  };
  let factoryCalls = 0;
  let stopCalls = 0;

  const resolver: BackendLaunchConfigResolver = (workspaceRoot) => ({
    workspaceRoot,
    configuredPythonPath: `python-${workspaceRoot}`,
  });
  const factory: BackendManagerFactory = () => {
    factoryCalls += 1;
    return {
      start: async () => new FakeClient(health, result),
      stop: async () => {
        stopCalls += 1;
      },
    };
  };

  const gateway = new BackendGateway(resolver, factory);

  await gateway.ping("C:/repo");
  await gateway.restart("C:/repo");

  assert.equal(factoryCalls, 2);
  assert.equal(stopCalls, 1);
});