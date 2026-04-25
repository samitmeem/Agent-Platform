import { isAbsolute, relative } from "node:path";

import type { BackendGateway } from "../backend/gateway";
import {
  buildMemoryPayloadFromRun,
  evaluatePreviewRunForAutoSave,
} from "../policies/memoryPolicy";
import type { ApprovalSettings } from "../policies/approvalPolicy";
import type {
  PreviewRunOutcome,
  PreviewRunMemoryStatus,
  PreviewRunSource,
  SessionStore,
  StoredPreviewRun,
} from "../state/sessionStore";

import type { AgentPreviewResult } from "./runtime";

export interface RecordPreviewRunInput {
  id: string;
  query: string;
  result: AgentPreviewResult;
  source: PreviewRunSource;
  activeFilePath?: string;
  startedAt?: string;
  durationMs?: number;
  outcome?: PreviewRunOutcome;
  createdAt?: string;
}

export interface RecordPreviewRunDependencies {
  gateway: BackendGateway;
  sessionStore: SessionStore;
  workspaceRoot: string;
  getApprovalSettings(): ApprovalSettings;
}

export interface RecordPreviewRunResult {
  run: StoredPreviewRun;
  memoryStatus: PreviewRunMemoryStatus;
}

function normalizeWorkspacePath(workspaceRoot: string, filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }

  return isAbsolute(filePath) ? relative(workspaceRoot, filePath) : filePath;
}

export async function recordPreviewRun(
  dependencies: RecordPreviewRunDependencies,
  input: RecordPreviewRunInput,
): Promise<RecordPreviewRunResult> {
  const run: StoredPreviewRun = {
    id: input.id,
    query: input.query,
    answer: input.result.answer,
    createdAt: input.createdAt ?? new Date().toISOString(),
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    source: input.source,
    outcome: input.outcome ?? "completed",
    activeFilePath: normalizeWorkspacePath(dependencies.workspaceRoot, input.activeFilePath),
    result: input.result,
  };

  const settings = dependencies.getApprovalSettings();
  if (!settings.autoSaveProjectMemory) {
    run.memoryStatus = {
      state: "disabled",
      reason: "Auto-save to project memory is disabled in settings.",
    };
    dependencies.sessionStore.savePreviewRun(run);
    return { run, memoryStatus: run.memoryStatus };
  }

  const decision = evaluatePreviewRunForAutoSave(run);
  if (!decision.shouldSave) {
    run.memoryStatus = {
      state: "skipped",
      reason: decision.reason,
    };
    dependencies.sessionStore.savePreviewRun(run);
    return { run, memoryStatus: run.memoryStatus };
  }

  try {
    await dependencies.gateway.invokeTool(
      dependencies.workspaceRoot,
      "memory_save",
      buildMemoryPayloadFromRun(run),
    );
    run.memoryStatus = {
      state: "saved",
      reason: decision.reason,
      savedAt: new Date().toISOString(),
    };
  } catch (error) {
    run.memoryStatus = {
      state: "failed",
      reason: error instanceof Error
        ? `Auto-save failed: ${error.message}`
        : `Auto-save failed: ${String(error)}`,
    };
  }

  dependencies.sessionStore.savePreviewRun(run);
  return { run, memoryStatus: run.memoryStatus };
}
