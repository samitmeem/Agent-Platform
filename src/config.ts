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

function normalizeApprovalMode(value: string | undefined, fallback: ApprovalMode): ApprovalMode {
  if (value === "allow" || value === "allow-trusted" || value === "ask") {
    return value;
  }
  return fallback;
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

export function isTokenSaviorConfigurationChange(
  event: vscode.ConfigurationChangeEvent,
): boolean {
  return event.affectsConfiguration("agentPlatform");
}