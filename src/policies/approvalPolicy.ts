import type { ToolPolicy } from "./toolPolicy";

export type ApprovalMode = "ask" | "allow" | "allow-trusted";

export interface ApprovalSettings {
  editMode: ApprovalMode;
  testMode: ApprovalMode;
  commandMode: ApprovalMode;
  destructiveMode: ApprovalMode;
  autoSaveProjectMemory: boolean;
  persistRunHistory: boolean;
}

export interface ApprovalDecision {
  required: boolean;
  reason: string;
}

export function shouldRequireApproval(
  policy: ToolPolicy,
  settings: ApprovalSettings,
  isWorkspaceTrusted: boolean,
): ApprovalDecision {
  if (!policy.requiresApprovalByDefault) {
    return { required: false, reason: "Tool is read-only or auto-approved by policy." };
  }

  const mode = policy.safetyClass === "edit"
    ? settings.editMode
    : policy.safetyClass === "test"
      ? settings.testMode
      : policy.safetyClass === "destructive"
        ? settings.destructiveMode
        : settings.commandMode;

  if (mode === "allow") {
    return { required: false, reason: "Approval disabled by configuration." };
  }

  if (mode === "allow-trusted" && isWorkspaceTrusted) {
    return { required: false, reason: "Trusted workspace is allowed to auto-run this action." };
  }

  return { required: true, reason: `Policy requires approval for ${policy.safetyClass} tools.` };
}
