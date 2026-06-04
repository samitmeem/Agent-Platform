import * as vscode from "vscode";

import type { ApprovalSettings, ApprovalMode } from "./policies/approvalPolicy";
import type { ProviderKind } from "./providers/base";

export interface ModelProviderSettings {
  preferredProvider: ProviderKind;
  copilotModelFamily?: string;
  copilotModelId?: string;
  localModelLabel: string;
  localEndpoint?: string;
  localModelName?: string;
  localApiFormat: "ollama" | "openai";
  localApiKey?: string;
}

export type AutomationProfile = "conservative" | "balanced" | "aggressive-but-safe";

export interface AutomationSettings {
  profile: AutomationProfile;
  refreshDebounceMs: number;
  profileScanEntryLimit: number;
  projectMemorySourceFileLimit: number;
  actionDiscoveryLimit: number;
  maxWorkspaceSuggestions: number;
  maxContextBundleChars: number;
  staleStateThresholdMinutes: number;
  suggestionNoiseThreshold: number;
  enableAutomaticProjectMemory: boolean;
  enableAutomaticSuggestions: boolean;
  enableAutomaticProjectModeRefresh: boolean;
  enableFileWatchRefresh: boolean;
  toolTimeoutMs: number;
}

const AUTOMATION_PROFILE_DEFAULTS: Record<AutomationProfile, Omit<AutomationSettings, "profile">> = {
  conservative: {
    refreshDebounceMs: 600,
    profileScanEntryLimit: 80,
    projectMemorySourceFileLimit: 8,
    actionDiscoveryLimit: 4,
    maxWorkspaceSuggestions: 2,
    maxContextBundleChars: 4_000,
    staleStateThresholdMinutes: 120,
    suggestionNoiseThreshold: 2,
    enableAutomaticProjectMemory: false,
    enableAutomaticSuggestions: false,
    enableAutomaticProjectModeRefresh: false,
    enableFileWatchRefresh: false,
    toolTimeoutMs: 30_000,
  },
  balanced: {
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
  },
  "aggressive-but-safe": {
    refreshDebounceMs: 150,
    profileScanEntryLimit: 240,
    projectMemorySourceFileLimit: 24,
    actionDiscoveryLimit: 12,
    maxWorkspaceSuggestions: 8,
    maxContextBundleChars: 8_000,
    staleStateThresholdMinutes: 30,
    suggestionNoiseThreshold: 2,
    enableAutomaticProjectMemory: true,
    enableAutomaticSuggestions: true,
    enableAutomaticProjectModeRefresh: true,
    enableFileWatchRefresh: true,
    toolTimeoutMs: 45_000,
  },
};

function normalizeApprovalMode(value: string | undefined, fallback: ApprovalMode): ApprovalMode {
  if (value === "allow" || value === "allow-trusted" || value === "ask") {
    return value;
  }
  return fallback;
}

function normalizeAutomationProfile(value: string | undefined): AutomationProfile {
  return value === "conservative" || value === "aggressive-but-safe"
    ? value
    : "balanced";
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value ?? fallback);
  if (rounded < minimum) {
    return minimum;
  }
  if (rounded > maximum) {
    return maximum;
  }

  return rounded;
}

export function getPrimaryWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function loadModelProviderSettings(): ModelProviderSettings {
  const config = vscode.workspace.getConfiguration("agentPlatform");
  const preferredProvider = config.get<string>("modelProvider") === "local"
    ? "local"
    : "copilot";
  const copilotModelFamily = config.get<string>("copilotModelFamily")?.trim() ?? "";
  const copilotModelId = config.get<string>("copilotModelId")?.trim() ?? "";
  const localModelLabel = config.get<string>("localModelLabel")?.trim() || "Local Model";
  const localEndpoint = config.get<string>("localEndpoint")?.trim() ?? "";
  const localModelName = config.get<string>("localModelName")?.trim() ?? "";
  const localApiFormat = config.get<string>("localApiFormat") === "openai"
    ? "openai"
    : "ollama";
  const localApiKey = config.get<string>("localApiKey")?.trim() ?? "";

  return {
    preferredProvider,
    copilotModelFamily: copilotModelFamily.length > 0 ? copilotModelFamily : undefined,
    copilotModelId: copilotModelId.length > 0 ? copilotModelId : undefined,
    localModelLabel,
    localEndpoint: localEndpoint.length > 0 ? localEndpoint : undefined,
    localModelName: localModelName.length > 0 ? localModelName : undefined,
    localApiFormat,
    localApiKey: localApiKey.length > 0 ? localApiKey : undefined,
  };
}

export function loadApprovalSettings(): ApprovalSettings {
  const config = vscode.workspace.getConfiguration("agentPlatform");
  return {
    editMode: normalizeApprovalMode(config.get<string>("editApprovalMode"), "ask"),
    testMode: normalizeApprovalMode(config.get<string>("testApprovalMode"), "allow-trusted"),
    commandMode: normalizeApprovalMode(config.get<string>("commandApprovalMode"), "allow-trusted"),
    destructiveMode: normalizeApprovalMode(config.get<string>("destructiveApprovalMode"), "ask"),
    autoSaveProjectMemory: config.get<boolean>("autoSaveProjectMemory") ?? false,
    persistRunHistory: config.get<boolean>("persistRunHistory") ?? true,
  };
}

export function loadAutomationSettings(): AutomationSettings {
  const config = vscode.workspace.getConfiguration("agentPlatform");
  const profile = normalizeAutomationProfile(config.get<string>("automationProfile"));
  const defaults = AUTOMATION_PROFILE_DEFAULTS[profile];

  return {
    profile,
    refreshDebounceMs: clampInteger(config.get<number>("refreshDebounceMs"), defaults.refreshDebounceMs, 50, 10_000),
    profileScanEntryLimit: clampInteger(config.get<number>("profileScanEntryLimit"), defaults.profileScanEntryLimit, 20, 1_000),
    projectMemorySourceFileLimit: clampInteger(config.get<number>("projectMemorySourceFileLimit"), defaults.projectMemorySourceFileLimit, 4, 128),
    actionDiscoveryLimit: clampInteger(config.get<number>("actionDiscoveryLimit"), defaults.actionDiscoveryLimit, 2, 32),
    maxWorkspaceSuggestions: clampInteger(config.get<number>("maxWorkspaceSuggestions"), defaults.maxWorkspaceSuggestions, 1, 20),
    maxContextBundleChars: clampInteger(config.get<number>("maxContextBundleChars"), defaults.maxContextBundleChars, 2_000, 20_000),
    staleStateThresholdMinutes: clampInteger(config.get<number>("staleStateThresholdMinutes"), defaults.staleStateThresholdMinutes, 5, 24 * 60),
    suggestionNoiseThreshold: clampInteger(config.get<number>("suggestionNoiseThreshold"), defaults.suggestionNoiseThreshold, 1, 20),
    enableAutomaticProjectMemory: defaults.enableAutomaticProjectMemory,
    enableAutomaticSuggestions: defaults.enableAutomaticSuggestions,
    enableAutomaticProjectModeRefresh: defaults.enableAutomaticProjectModeRefresh,
    enableFileWatchRefresh: defaults.enableFileWatchRefresh,
    toolTimeoutMs: clampInteger(config.get<number>("toolTimeoutMs"), defaults.toolTimeoutMs, 1_000, 300_000),
  };
}

export function isTokenSaviorConfigurationChange(
  event: vscode.ConfigurationChangeEvent,
): boolean {
  return [
    "agentPlatform.backend.enabled",
    "agentPlatform.pythonPath",
    "agentPlatform.serviceModule",
    "agentPlatform.modelProvider",
    "agentPlatform.copilotModelFamily",
    "agentPlatform.copilotModelId",
    "agentPlatform.localModelLabel",
    "agentPlatform.localEndpoint",
    "agentPlatform.localModelName",
    "agentPlatform.localApiFormat",
    "agentPlatform.localApiKey",
  ].some((key) => event.affectsConfiguration(key));
}