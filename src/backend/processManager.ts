import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { JsonRpcServiceClient } from "./client";

export interface BackendLaunchConfig {
  workspaceRoot: string;
  configuredPythonPath?: string;
  serviceModule?: string;
  env?: NodeJS.ProcessEnv;
}

export function detectWorkspacePythonPath(
  workspaceRoot: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const candidates = platform === "win32"
    ? [join(workspaceRoot, ".venv", "Scripts", "python.exe")]
    : [join(workspaceRoot, ".venv", "bin", "python")];

  return candidates.find((candidate) => existsSync(candidate));
}

export function resolvePythonCommand(config: BackendLaunchConfig): string {
  if (config.configuredPythonPath && config.configuredPythonPath.trim().length > 0) {
    return config.configuredPythonPath;
  }

  return detectWorkspacePythonPath(config.workspaceRoot) ?? "python";
}

export function buildSpawnOptions(
  config: BackendLaunchConfig,
): {
  command: string;
  args: string[];
  spawnOptions: SpawnOptionsWithoutStdio;
} {
  const command = resolvePythonCommand(config);
  const serviceModule = config.serviceModule ?? "token_savior.service_api.server";
  const srcPath = join(config.workspaceRoot, "src");
  const pythonPathParts = [srcPath, config.env?.PYTHONPATH ?? process.env.PYTHONPATH ?? ""]
    .filter((part) => part.length > 0);
  const workspaceRoots = config.env?.WORKSPACE_ROOTS
    ?? process.env.WORKSPACE_ROOTS
    ?? config.workspaceRoot;
  const projectRoot = config.env?.PROJECT_ROOT
    ?? process.env.PROJECT_ROOT
    ?? config.workspaceRoot;

  return {
    command,
    args: ["-m", serviceModule],
    spawnOptions: {
      cwd: config.workspaceRoot,
      env: {
        ...process.env,
        ...config.env,
        PROJECT_ROOT: projectRoot,
        PYTHONPATH: pythonPathParts.join(process.platform === "win32" ? ";" : ":"),
        WORKSPACE_ROOTS: workspaceRoots,
      },
      stdio: "pipe",
    },
  };
}

export class BackendProcessManager {
  private process: ChildProcessWithoutNullStreams | undefined;
  private client: JsonRpcServiceClient | undefined;

  public constructor(private readonly config: BackendLaunchConfig) {}

  public async start(): Promise<JsonRpcServiceClient> {
    if (this.process && this.client) {
      return this.client;
    }

    const { command, args, spawnOptions } = buildSpawnOptions(this.config);
    const child = spawn(command, args, spawnOptions);
    const client = new JsonRpcServiceClient(child.stdout, child.stdin);

    child.on("exit", () => {
      client.dispose(new Error("Token Savior backend exited"));
      this.process = undefined;
      this.client = undefined;
    });
    child.on("error", (error) => {
      client.dispose(error);
      this.process = undefined;
      this.client = undefined;
    });

    this.process = child;
    this.client = client;
    await client.request("health.ping", {});
    return client;
  }

  public async stop(): Promise<void> {
    if (this.client) {
      this.client.dispose(new Error("Token Savior backend stopped"));
      this.client = undefined;
    }
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
  }
}