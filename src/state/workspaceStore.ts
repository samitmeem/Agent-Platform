import * as vscode from "vscode";

import type { StoredPreviewRun, SessionStore } from "./sessionStore";
import {
  DEFAULT_WORKSPACE_REFRESH_STATE,
  type WorkspacePhaseAssessment,
  type WorkspaceProjectMode,
  type WorkspaceProjectMemory,
  type WorkspaceProfile,
  type WorkspaceRefreshState,
  type WorkspaceSuggestion,
} from "./workspaceAnalysis";

const PREVIEW_RUNS_KEY = "tokenSavior.previewRuns";
const LAST_CHECKPOINT_KEY = "tokenSavior.lastCheckpoint";
const ACTIVE_RUN_KEY = "tokenSavior.activeRun";
const WORKSPACE_PROFILE_KEY = "agentPlatform.workspaceProfile";
const WORKSPACE_PHASE_KEY = "agentPlatform.workspacePhase";
const WORKSPACE_REFRESH_KEY = "agentPlatform.workspaceRefresh";
const WORKSPACE_PROJECT_MODE_KEY = "agentPlatform.workspaceProjectMode";
const WORKSPACE_PROJECT_MEMORY_KEY = "agentPlatform.workspaceProjectMemory";
const WORKSPACE_SUGGESTIONS_KEY = "agentPlatform.workspaceSuggestions";

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

  public saveWorkspaceProfile(profile: WorkspaceProfile): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_PROFILE_KEY, profile);
  }

  public getWorkspaceProfile(): WorkspaceProfile | undefined {
    return this.workspaceState.get<WorkspaceProfile>(WORKSPACE_PROFILE_KEY);
  }

  public clearWorkspaceProfile(): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_PROFILE_KEY, undefined);
  }

  public saveWorkspacePhase(phase: WorkspacePhaseAssessment): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_PHASE_KEY, phase);
  }

  public getWorkspacePhase(): WorkspacePhaseAssessment | undefined {
    return this.workspaceState.get<WorkspacePhaseAssessment>(WORKSPACE_PHASE_KEY);
  }

  public clearWorkspacePhase(): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_PHASE_KEY, undefined);
  }

  public saveWorkspaceRefreshState(state: WorkspaceRefreshState): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_REFRESH_KEY, state);
  }

  public getWorkspaceRefreshState(): WorkspaceRefreshState {
    return this.workspaceState.get<WorkspaceRefreshState>(WORKSPACE_REFRESH_KEY, DEFAULT_WORKSPACE_REFRESH_STATE);
  }

  public saveWorkspaceProjectMode(snapshot: WorkspaceProjectMode): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_PROJECT_MODE_KEY, snapshot);
  }

  public getWorkspaceProjectMode(): WorkspaceProjectMode | undefined {
    return this.workspaceState.get<WorkspaceProjectMode>(WORKSPACE_PROJECT_MODE_KEY);
  }

  public clearWorkspaceProjectMode(): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_PROJECT_MODE_KEY, undefined);
  }

  public saveWorkspaceProjectMemory(snapshot: WorkspaceProjectMemory): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_PROJECT_MEMORY_KEY, snapshot);
  }

  public getWorkspaceProjectMemory(): WorkspaceProjectMemory | undefined {
    return this.workspaceState.get<WorkspaceProjectMemory>(WORKSPACE_PROJECT_MEMORY_KEY);
  }

  public clearWorkspaceProjectMemory(): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_PROJECT_MEMORY_KEY, undefined);
  }

  public saveWorkspaceSuggestions(suggestions: WorkspaceSuggestion[]): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_SUGGESTIONS_KEY, suggestions);
  }

  public getWorkspaceSuggestions(): WorkspaceSuggestion[] {
    return this.workspaceState.get<WorkspaceSuggestion[]>(WORKSPACE_SUGGESTIONS_KEY, []);
  }

  public clearWorkspaceSuggestions(): Thenable<void> {
    return this.workspaceState.update(WORKSPACE_SUGGESTIONS_KEY, undefined);
  }
}
