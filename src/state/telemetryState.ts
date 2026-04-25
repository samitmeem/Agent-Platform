import * as vscode from "vscode";

import { deriveRunFailureMessage } from "../agent/runtime";
import type { PreviewRunOutcome, StoredPreviewRun } from "./sessionStore";
import type { PreviewRunSource } from "./sessionStore";

const TELEMETRY_KEY = "tokenSavior.telemetry";

export interface TelemetrySnapshot {
  totalRuns: number;
  previewRuns: number;
  actionRuns: number;
  chatRuns: number;
  commandRuns: number;
  completedRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  backendRestarts: number;
  recoveryEvents: number;
  totalToolCalls: number;
  totalDurationMs: number;
  averageDurationMs: number;
  providerUsage: Record<string, number>;
  lastRunAt?: string;
  lastFailureMessage?: string;
  lastRecoveryMessage?: string;
}

export interface TelemetryRunEvent {
  mode: "preview" | "action";
  source: PreviewRunSource;
  outcome: PreviewRunOutcome;
  durationMs: number;
  providerKind?: string;
  toolCallCount: number;
  finishedAt?: string;
  errorMessage?: string;
}

const DEFAULT_SNAPSHOT: TelemetrySnapshot = {
  totalRuns: 0,
  previewRuns: 0,
  actionRuns: 0,
  chatRuns: 0,
  commandRuns: 0,
  completedRuns: 0,
  failedRuns: 0,
  cancelledRuns: 0,
  backendRestarts: 0,
  recoveryEvents: 0,
  totalToolCalls: 0,
  totalDurationMs: 0,
  averageDurationMs: 0,
  providerUsage: {},
};

export class TelemetryState {
  public constructor(private readonly workspaceState: vscode.Memento) {}

  public getSnapshot(): TelemetrySnapshot {
    return this.workspaceState.get<TelemetrySnapshot>(TELEMETRY_KEY, DEFAULT_SNAPSHOT);
  }

  public async reset(): Promise<void> {
    await this.workspaceState.update(TELEMETRY_KEY, { ...DEFAULT_SNAPSHOT });
  }

  public async recordRun(run: StoredPreviewRun): Promise<TelemetrySnapshot> {
    return this.recordRunEvent({
      mode: run.result.mode ?? "preview",
      source: run.source ?? "command",
      outcome: run.outcome ?? "completed",
      durationMs: run.durationMs ?? 0,
      providerKind: run.result.providerKind,
      toolCallCount: run.result.toolResults?.length ?? (run.result.toolResult ? 1 : 0),
      finishedAt: run.createdAt,
      errorMessage: run.outcome === "failed" ? deriveRunFailureMessage(run.result) : undefined,
    });
  }

  public async recordRunEvent(event: TelemetryRunEvent): Promise<TelemetrySnapshot> {
    const current = this.getSnapshot();
    const providerUsage = { ...current.providerUsage };
    if (event.providerKind) {
      providerUsage[event.providerKind] = (providerUsage[event.providerKind] ?? 0) + 1;
    }

    const updated: TelemetrySnapshot = {
      ...current,
      totalRuns: current.totalRuns + 1,
      previewRuns: current.previewRuns + (event.mode === "preview" ? 1 : 0),
      actionRuns: current.actionRuns + (event.mode === "action" ? 1 : 0),
      chatRuns: current.chatRuns + (event.source === "chat" ? 1 : 0),
      commandRuns: current.commandRuns + (event.source === "command" ? 1 : 0),
      completedRuns: current.completedRuns + (event.outcome === "completed" ? 1 : 0),
      failedRuns: current.failedRuns + (event.outcome === "failed" ? 1 : 0),
      cancelledRuns: current.cancelledRuns + (event.outcome === "cancelled" ? 1 : 0),
      totalToolCalls: current.totalToolCalls + event.toolCallCount,
      totalDurationMs: current.totalDurationMs + event.durationMs,
      averageDurationMs: Math.round((current.totalDurationMs + event.durationMs) / (current.totalRuns + 1)),
      providerUsage,
      lastRunAt: event.finishedAt ?? new Date().toISOString(),
      lastFailureMessage: event.outcome === "failed" ? event.errorMessage : current.lastFailureMessage,
    };

    await this.workspaceState.update(TELEMETRY_KEY, updated);
    return updated;
  }

  public async recordBackendRestart(): Promise<TelemetrySnapshot> {
    const updated = {
      ...this.getSnapshot(),
      backendRestarts: this.getSnapshot().backendRestarts + 1,
    };
    await this.workspaceState.update(TELEMETRY_KEY, updated);
    return updated;
  }

  public async recordRecoveryEvent(message: string): Promise<TelemetrySnapshot> {
    const current = this.getSnapshot();
    const updated = {
      ...current,
      recoveryEvents: current.recoveryEvents + 1,
      lastRecoveryMessage: message,
    };
    await this.workspaceState.update(TELEMETRY_KEY, updated);
    return updated;
  }
}
