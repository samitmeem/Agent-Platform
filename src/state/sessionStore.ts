import type { AgentPreviewResult } from "../agent/runtime";

export type PreviewRunSource = "chat" | "command";
export type PreviewRunOutcome = "completed" | "failed" | "cancelled";

export interface PreviewRunMemoryStatus {
  state: "disabled" | "skipped" | "saved" | "failed" | "manual";
  reason: string;
  savedAt?: string;
}

export interface StoredPreviewRun {
  id: string;
  query: string;
  answer: string;
  createdAt: string;
  startedAt?: string;
  durationMs?: number;
  source?: PreviewRunSource;
  outcome?: PreviewRunOutcome;
  activeFilePath?: string;
  memoryStatus?: PreviewRunMemoryStatus;
  result: AgentPreviewResult;
}

export type SessionStoreListener = () => void;

export class SessionStore {
  private readonly previewRuns: StoredPreviewRun[] = [];
  private readonly listeners = new Set<SessionStoreListener>();

  public constructor(private readonly maxRuns = 10) {}

  public savePreviewRun(run: StoredPreviewRun): void {
    this.previewRuns.unshift(run);
    if (this.previewRuns.length > this.maxRuns) {
      this.previewRuns.length = this.maxRuns;
    }

    this.emitChanged();
  }

  public getLastPreviewRun(): StoredPreviewRun | undefined {
    return this.previewRuns[0];
  }

  public listPreviewRuns(limit = this.maxRuns): StoredPreviewRun[] {
    return this.previewRuns.slice(0, limit);
  }

  public getPreviewRun(id: string): StoredPreviewRun | undefined {
    return this.previewRuns.find((run) => run.id === id);
  }

  public updatePreviewRun(id: string, updater: (run: StoredPreviewRun) => StoredPreviewRun): void {
    const index = this.previewRuns.findIndex((run) => run.id === id);
    if (index < 0) {
      return;
    }

    this.previewRuns[index] = updater(this.previewRuns[index]);
    this.emitChanged();
  }

  public replacePreviewRuns(runs: readonly StoredPreviewRun[]): void {
    this.previewRuns.length = 0;
    this.previewRuns.push(...runs.slice(0, this.maxRuns));
    this.emitChanged();
  }

  public subscribe(listener: SessionStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public clear(): void {
    this.previewRuns.length = 0;
    this.emitChanged();
  }

  private emitChanged(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
