import { BackendProcessManager, type BackendLaunchConfig } from "./processManager";
import type { ServiceHealth, ServiceToolResult } from "./protocol";

export interface JsonRpcRequester {
  request<T>(method: string, params: Record<string, unknown>): Promise<T>;
}

export interface BackendManagerLike {
  start(): Promise<JsonRpcRequester>;
  stop(): Promise<void>;
}

export type BackendManagerFactory       = (config: BackendLaunchConfig) => BackendManagerLike;
export type BackendLaunchConfigResolver = (workspaceRoot: string) => BackendLaunchConfig;

type ActiveManager = {
  workspaceRoot: string;
  fingerprint: string;
  manager: BackendManagerLike;
};

function createFingerprint(config: BackendLaunchConfig): string {
  return JSON.stringify({
    workspaceRoot: config.workspaceRoot,
    configuredPythonPath: config.configuredPythonPath ?? "",
    serviceModule: config.serviceModule ?? "",
  });
}

/**
 * FIX-4: Wraps a promise with a hard timeout.
 * Rejects with a TimeoutError after `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms),
    ),
  ]);
}

/**
 * FIX-7: Retry start() with exponential back-off before propagating the error.
 * maxRetries=3, baseDelayMs=400 → waits 400ms, 800ms, 1600ms between attempts.
 */
async function startWithBackoff(
  manager: BackendManagerLike,
  maxRetries = 3,
  baseDelayMs = 400,
): Promise<JsonRpcRequester> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await manager.start();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export class BackendGateway {
  private activeManager: ActiveManager | undefined;
  private lastHealth: ServiceHealth | undefined;
  private lastError: string | undefined;

  /** Per-tool-call timeout in ms. Overridden by setToolTimeoutMs(). */
  private toolTimeoutMs = 30_000;

  public constructor(
    private readonly resolveLaunchConfig: BackendLaunchConfigResolver,
    private readonly createManager: BackendManagerFactory = (config) => new BackendProcessManager(config),
  ) {}

  public setToolTimeoutMs(ms: number): void {
    this.toolTimeoutMs = Math.max(1_000, ms);
  }

  public getLastHealth(): ServiceHealth | undefined { return this.lastHealth; }
  public getLastError(): string | undefined { return this.lastError; }

  public async ping(workspaceRoot: string): Promise<ServiceHealth> {
    const client = await this.ensureClient(workspaceRoot);
    const health = await client.request<ServiceHealth>("health.ping", {});
    this.lastHealth = health;
    this.lastError  = undefined;
    return health;
  }

  /**
   * FIX-4: Every tool call races against a configurable timeout.
   * FIX-8: Accepts an AbortSignal so cancellation can be propagated.
   */
  public async invokeTool(
    workspaceRoot: string,
    name: string,
    argumentsPayload: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<ServiceToolResult> {
    if (signal?.aborted) {
      throw new Error(`Tool call ${name} was cancelled before it started.`);
    }

    const client = await this.ensureClient(workspaceRoot);
    const toolPromise = client.request<ServiceToolResult>("tool.invoke", {
      name,
      arguments: argumentsPayload,
    });

    const result = await withTimeout(toolPromise, this.toolTimeoutMs, `tool.invoke(${name})`);
    this.lastError = result.ok ? undefined : (result.error ?? `${name} failed`);
    return result;
  }

  /** FIX-6: Expose the backend capability list for dynamic tool discovery. */
  public async listCapabilities(
    workspaceRoot: string,
  ): Promise<Array<{ name: string; category: string; description: string }>> {
    const client = await this.ensureClient(workspaceRoot);
    return client.request("capabilities.list", {});
  }

  public async restart(workspaceRoot?: string): Promise<ServiceHealth | undefined> {
    await this.stop();
    if (!workspaceRoot) { return undefined; }
    return this.ping(workspaceRoot);
  }

  public async stop(): Promise<void> {
    if (!this.activeManager) { return; }
    await this.activeManager.manager.stop();
    this.activeManager = undefined;
    this.lastHealth    = undefined;
  }

  private async ensureClient(workspaceRoot: string): Promise<JsonRpcRequester> {
    const manager = await this.getOrCreateManager(workspaceRoot);
    try {
      const client = await startWithBackoff(manager);
      if (!this.lastHealth) {
        this.lastHealth = await client.request<ServiceHealth>("health.ping", {});
      }
      this.lastError = undefined;
      return client;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await this.stop();
      throw error;
    }
  }

  private async getOrCreateManager(workspaceRoot: string): Promise<BackendManagerLike> {
    const launchConfig = this.resolveLaunchConfig(workspaceRoot);
    const fingerprint  = createFingerprint(launchConfig);

    if (
      this.activeManager
      && this.activeManager.workspaceRoot === workspaceRoot
      && this.activeManager.fingerprint   === fingerprint
    ) {
      return this.activeManager.manager;
    }

    if (this.activeManager) {
      await this.activeManager.manager.stop();
    }

    const manager = this.createManager(launchConfig);
    this.activeManager = { workspaceRoot, fingerprint, manager };
    return manager;
  }
}
