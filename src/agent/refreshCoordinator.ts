import type { SessionStore } from "../state/sessionStore";
import type { AutomationSettings } from "../config";
import {
  DEFAULT_WORKSPACE_REFRESH_STATE,
  type WorkspacePhaseAssessment,
  type WorkspaceProfile,
} from "../state/workspaceAnalysis";
import type { WorkspaceStore } from "../state/workspaceStore";
import { deriveWorkspaceProjectActionSuggestions } from "./copilotToolState";
import { detectWorkspacePhase } from "./phaseDetector";
import {
  initializeProjectMemorySnapshot,
  type ProjectMemoryInitializerResult,
} from "./projectMemoryInitializer";
import {
  deriveWorkspaceProjectMode,
} from "./projectMode";
import {
  deriveWorkspaceSuggestions,
  type DiscoveredWorkspaceAction,
} from "./suggestionEngine";
import {
  buildWorkspaceProfile,
  type WorkspaceBootstrapResult,
} from "./workspaceBootstrap";

export interface RefreshCoordinatorOutput {
  appendLine(message: string): void;
}

export interface WorkspaceRefreshTelemetryEvent {
  reason: string;
  ok: boolean;
  stale: boolean;
  automationProfile: string;
  previousPhase?: string;
  nextPhase?: string;
  previousSuggestions?: readonly string[];
  nextSuggestions?: readonly string[];
  suggestionNoiseThreshold?: number;
}

export interface WorkspaceRefreshCoordinatorDependencies {
  getWorkspaceRoot: () => string | undefined;
  sessionStore: SessionStore;
  workspaceStore: WorkspaceStore;
  outputChannel?: RefreshCoordinatorOutput;
  bootstrapTimeoutMs?: number;
  now?: () => string;
  resolveAutomationSettings?: () => AutomationSettings;
  onRefreshTelemetry?: (event: WorkspaceRefreshTelemetryEvent) => Promise<void> | void;
  buildWorkspaceProfile?: (...args: Parameters<typeof buildWorkspaceProfile>) => Promise<WorkspaceBootstrapResult>;
  detectWorkspacePhase?: (profile: WorkspaceProfile) => WorkspacePhaseAssessment;
  initializeProjectMemorySnapshot?: (input: Parameters<typeof initializeProjectMemorySnapshot>[0]) => Promise<ProjectMemoryInitializerResult>;
  deriveWorkspaceProjectMode?: typeof deriveWorkspaceProjectMode;
  deriveWorkspaceSuggestions?: typeof deriveWorkspaceSuggestions;
}

const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 4_000;
const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  profile: "balanced",
  refreshDebounceMs: 250,
  profileScanEntryLimit: 160,
  projectMemorySourceFileLimit: 16,
  actionDiscoveryLimit: 8,
  maxWorkspaceSuggestions: 6,
  maxContextBundleChars: 6_000,
  staleStateThresholdMinutes: 60,
  suggestionNoiseThreshold: 3,
  enableAutomaticProjectMemory: true,
  enableAutomaticSuggestions: true,
  enableAutomaticProjectModeRefresh: true,
  enableFileWatchRefresh: true,
  toolTimeoutMs: 30_000,
};

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter((value) => value.length > 0))];
}

function withAutomationDefaults(settings: AutomationSettings | undefined): AutomationSettings {
  return settings ?? DEFAULT_AUTOMATION_SETTINGS;
}

function isRefreshStale(lastSuccessfulRefreshAt: string | undefined, thresholdMinutes: number, nowIso: string): boolean {
  if (!lastSuccessfulRefreshAt) {
    return false;
  }

  const last = Date.parse(lastSuccessfulRefreshAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) {
    return false;
  }

  return now - last > thresholdMinutes * 60_000;
}

export class WorkspaceRefreshCoordinator {
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private activeRefresh: Promise<void> | undefined;
  private queuedReason: string | undefined;

  public constructor(private readonly dependencies: WorkspaceRefreshCoordinatorDependencies) {}

  public scheduleRefresh(reason: string): void {
    const automationSettings = withAutomationDefaults(this.dependencies.resolveAutomationSettings?.());
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshNow(reason);
    }, automationSettings.refreshDebounceMs);
  }

  public async refreshNow(reason = "manual"): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }

    if (this.activeRefresh) {
      this.queuedReason = reason;
      return this.activeRefresh;
    }

    this.activeRefresh = this.runRefresh(reason).finally(async () => {
      this.activeRefresh = undefined;
      const queuedReason = this.queuedReason;
      this.queuedReason = undefined;
      if (queuedReason) {
        await this.refreshNow(queuedReason);
      }
    });

    return this.activeRefresh;
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private async runRefresh(reason: string): Promise<void> {
    const automationSettings = withAutomationDefaults(this.dependencies.resolveAutomationSettings?.());
    const workspaceRoot = this.dependencies.getWorkspaceRoot();
    const workspaceStore = this.dependencies.workspaceStore;
    const previousRefresh = workspaceStore.getWorkspaceRefreshState();
    const previousPhase = workspaceStore.getWorkspacePhase();
    const previousSuggestions = workspaceStore.getWorkspaceSuggestions();
    const refreshStartedAt = (this.dependencies.now ?? (() => new Date().toISOString()))();

    if (!workspaceRoot) {
      await Promise.all([
        workspaceStore.clearWorkspaceProfile(),
        workspaceStore.clearWorkspacePhase(),
        workspaceStore.clearWorkspaceProjectMode(),
        workspaceStore.clearWorkspaceProjectMemory(),
        workspaceStore.clearWorkspaceSuggestions(),
        workspaceStore.saveWorkspaceRefreshState({
          ...DEFAULT_WORKSPACE_REFRESH_STATE,
          lastRefreshAt: refreshStartedAt,
          warnings: ["Open a workspace folder to enable automatic workspace profiling."],
        }),
      ]);
      await this.dependencies.onRefreshTelemetry?.({
        reason,
        ok: true,
        stale: false,
        automationProfile: automationSettings.profile,
        previousPhase: previousPhase?.phase,
        previousSuggestions: previousSuggestions.map((suggestion) => suggestion.title),
        nextSuggestions: [],
        suggestionNoiseThreshold: automationSettings.suggestionNoiseThreshold,
      });
      return;
    }

    await workspaceStore.saveWorkspaceRefreshState({
      ...previousRefresh,
      status: "running",
      stale: isRefreshStale(previousRefresh.lastSuccessfulRefreshAt, automationSettings.staleStateThresholdMinutes, refreshStartedAt),
      lastRefreshAt: refreshStartedAt,
      lastError: undefined,
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const bootstrapResult = await Promise.race([
        (this.dependencies.buildWorkspaceProfile ?? buildWorkspaceProfile)(workspaceRoot, {
          maxRootEntries: automationSettings.profileScanEntryLimit,
          maxLikelyActions: automationSettings.actionDiscoveryLimit,
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Workspace bootstrap timed out after ${this.dependencies.bootstrapTimeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS} ms.`));
          }, this.dependencies.bootstrapTimeoutMs ?? DEFAULT_BOOTSTRAP_TIMEOUT_MS);
        }),
      ]);
      const profile = bootstrapResult.profile;
      const phase = (this.dependencies.detectWorkspacePhase ?? detectWorkspacePhase)(profile);
      const previousProjectMemory = workspaceStore.getWorkspaceProjectMemory();
      const previousProjectMode = workspaceStore.getWorkspaceProjectMode();
      const recentRuns = this.dependencies.sessionStore.listPreviewRuns(8);
      const projectMemory = automationSettings.enableAutomaticProjectMemory
        ? await (this.dependencies.initializeProjectMemorySnapshot ?? initializeProjectMemorySnapshot)({
          workspaceRoot,
          profile,
          phase,
          previousSnapshot: previousProjectMemory,
          maxSourceFiles: automationSettings.projectMemorySourceFileLimit,
        })
        : undefined;
      const projectMode = automationSettings.enableAutomaticProjectModeRefresh
        ? (this.dependencies.deriveWorkspaceProjectMode ?? deriveWorkspaceProjectMode)({
          profile,
          phase,
          projectMemory: projectMemory?.snapshot ?? previousProjectMemory,
          recentRuns,
          previousSnapshot: previousProjectMode,
          createdAt: (this.dependencies.now ?? (() => new Date().toISOString()))(),
        })
        : undefined;
      const discoveredActions: DiscoveredWorkspaceAction[] = deriveWorkspaceProjectActionSuggestions({
        workspaceRoot,
        profile,
        phase,
        refresh: previousRefresh,
        projectMode: projectMode?.snapshot ?? previousProjectMode,
        projectMemory: projectMemory?.snapshot ?? previousProjectMemory,
        suggestions: [],
        recentRuns,
      }).map((action) => ({
        label: action.label,
        description: action.description,
        kind: action.kind,
        runnable: action.runnable,
        source: action.source,
      }));
      const suggestions = automationSettings.enableAutomaticSuggestions
        ? (this.dependencies.deriveWorkspaceSuggestions ?? deriveWorkspaceSuggestions)({
          profile,
          phase,
          projectMemory: projectMemory?.snapshot ?? previousProjectMemory,
          refresh: DEFAULT_WORKSPACE_REFRESH_STATE,
          recentRuns,
          discoveredActions,
          lastApprovedWorkflow: projectMode?.snapshot.lastApprovedWorkflow ?? previousProjectMode?.lastApprovedWorkflow,
          maxSuggestions: automationSettings.maxWorkspaceSuggestions,
          createdAt: (this.dependencies.now ?? (() => new Date().toISOString()))(),
        })
        : [];
      const completedAt = (this.dependencies.now ?? (() => new Date().toISOString()))();
      const combinedWarnings = uniqueStrings([
        ...bootstrapResult.warnings,
        ...(projectMemory?.warnings ?? []),
        !automationSettings.enableAutomaticProjectMemory
          ? `Automation profile ${automationSettings.profile} disables automatic project memory refresh.`
          : "",
        !automationSettings.enableAutomaticSuggestions
          ? `Automation profile ${automationSettings.profile} disables automatic ranked suggestions.`
          : "",
        !automationSettings.enableAutomaticProjectModeRefresh
          ? `Automation profile ${automationSettings.profile} leaves project-mode continuity updates to explicit approved workflows.`
          : "",
      ]);

      await Promise.all([
        workspaceStore.saveWorkspaceProfile(profile),
        workspaceStore.saveWorkspacePhase(phase),
        projectMode && (projectMode.changed || !previousProjectMode)
          ? workspaceStore.saveWorkspaceProjectMode(projectMode.snapshot)
          : Promise.resolve(),
        workspaceStore.saveWorkspaceSuggestions(suggestions),
        projectMemory && (projectMemory.changed || !previousProjectMemory)
          ? workspaceStore.saveWorkspaceProjectMemory(projectMemory.snapshot)
          : Promise.resolve(),
        workspaceStore.saveWorkspaceRefreshState({
          status: "ready",
          stale: false,
          warnings: combinedWarnings,
          lastRefreshAt: completedAt,
          lastSuccessfulRefreshAt: completedAt,
        }),
      ]);

      await this.dependencies.onRefreshTelemetry?.({
        reason,
        ok: true,
        stale: false,
        automationProfile: automationSettings.profile,
        previousPhase: previousPhase?.phase,
        nextPhase: phase.phase,
        previousSuggestions: previousSuggestions.map((suggestion) => suggestion.title),
        nextSuggestions: suggestions.map((suggestion) => suggestion.title),
        suggestionNoiseThreshold: automationSettings.suggestionNoiseThreshold,
      });

      this.dependencies.outputChannel?.appendLine(
        `[workspace-refresh] ${reason}: profile=${automationSettings.profile} repoType=${profile.repoType} phase=${phase.phase} projectMode=${projectMode?.changed ? "updated" : "unchanged"} projectMemory=${projectMemory?.changed ? "updated" : automationSettings.enableAutomaticProjectMemory ? "unchanged" : "disabled"} suggestions=${automationSettings.enableAutomaticSuggestions ? suggestions.length : 0}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stale = isRefreshStale(
        previousRefresh.lastSuccessfulRefreshAt,
        automationSettings.staleStateThresholdMinutes,
        (this.dependencies.now ?? (() => new Date().toISOString()))(),
      );
      await workspaceStore.saveWorkspaceRefreshState({
        status: "error",
        stale,
        warnings: previousRefresh.warnings,
        lastRefreshAt: (this.dependencies.now ?? (() => new Date().toISOString()))(),
        lastSuccessfulRefreshAt: previousRefresh.lastSuccessfulRefreshAt,
        lastError: message,
      });
      await this.dependencies.onRefreshTelemetry?.({
        reason,
        ok: false,
        stale,
        automationProfile: automationSettings.profile,
        previousPhase: previousPhase?.phase,
        previousSuggestions: previousSuggestions.map((suggestion) => suggestion.title),
        nextSuggestions: previousSuggestions.map((suggestion) => suggestion.title),
        suggestionNoiseThreshold: automationSettings.suggestionNoiseThreshold,
      });
      this.dependencies.outputChannel?.appendLine(`[workspace-refresh] ${reason} failed: ${message}`);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}