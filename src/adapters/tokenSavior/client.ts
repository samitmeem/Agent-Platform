import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number | null;
  error: {
    code: number;
    message: string;
  };
}

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export class JsonRpcServiceClient extends EventEmitter {
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = "";
  private nextId = 1;
  private disposed = false;

  public constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {
    super();
    this.input.setEncoding("utf8");
    this.input.on("data", (chunk: string) => this.onData(chunk));
    this.input.on("error", (error) => this.dispose(error));
    this.input.on("end", () => this.dispose(new Error("Backend stream ended")));
  }

  public async request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (this.disposed) {
      throw new Error("JSON-RPC client is disposed");
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.output.write(JSON.stringify(payload) + "\n", "utf8");
    });
  }

  public dispose(cause?: Error): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const error = cause ?? new Error("JSON-RPC client disposed");
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
    this.removeAllListeners();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.handleLine(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcSuccess | JsonRpcFailure;
    try {
      message = JSON.parse(line) as JsonRpcSuccess | JsonRpcFailure;
    } catch (error) {
      this.emit("protocolError", error);
      return;
    }

    const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!pending) {
      this.emit("orphanMessage", message);
      return;
    }
    this.pending.delete(message.id as number);

    if ("error" in message) {
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  }
}