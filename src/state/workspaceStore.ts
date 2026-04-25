import * as vscode from "vscode";

import type { StoredPreviewRun, SessionStore } from "./sessionStore";

const PREVIEW_RUNS_KEY = "tokenSavior.previewRuns";
const LAST_CHECKPOINT_KEY = "tokenSavior.lastCheckpoint";
const ACTIVE_RUN_KEY = "tokenSavior.activeRun";

export interface LastCheckpointRecord {
  checkpointId: string;
  createdAt: string;
  filePath?: string;
}

export interface ActiveRunRecord {
  id: string;
  query: string;
  mode: "preview" | "action";
  source: "chat" | "command";
  startedAt: string;
  activeFilePath?: string;
}

export class WorkspaceStore {
  public constructor(private readonly workspaceState: vscode.Memento) {}

  public hydrateSessionStore(sessionStore: SessionStore): void {
    const runs = this.workspaceState.get<StoredPreviewRun[]>(PREVIEW_RUNS_KEY, []);
    sessionStore.replacePreviewRuns(runs);
  }

  public persistPreviewRuns(runs: StoredPreviewRun[]): Thenable<void> {
    return this.workspaceState.update(PREVIEW_RUNS_KEY, runs);
  }

  public saveLastCheckpoint(record: LastCheckpointRecord): Thenable<void> {
    return this.workspaceState.update(LAST_CHECKPOINT_KEY, record);
  }

  public getLastCheckpoint(): LastCheckpointRecord | undefined {
    return this.workspaceState.get<LastCheckpointRecord>(LAST_CHECKPOINT_KEY);
  }

  public clearLastCheckpoint(): Thenable<void> {
    return this.workspaceState.update(LAST_CHECKPOINT_KEY, undefined);
  }

  public saveActiveRun(record: ActiveRunRecord): Thenable<void> {
    return this.workspaceState.update(ACTIVE_RUN_KEY, record);
  }

  public getActiveRun(): ActiveRunRecord | undefined {
    return this.workspaceState.get<ActiveRunRecord>(ACTIVE_RUN_KEY);
  }

  public clearActiveRun(): Thenable<void> {
    return this.workspaceState.update(ACTIVE_RUN_KEY, undefined);
  }
}
