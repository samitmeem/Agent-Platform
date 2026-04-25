import type { ToolResult } from "../tools/interface";
import type { ToolProviderRegistry } from "../tools/providerRegistry";
import type { ApprovalSettings } from "../policies/approvalPolicy";
import { shouldRequireApproval } from "../policies/approvalPolicy";
import type { ToolPolicyRegistry } from "../policies/toolPolicy";

export class ToolApprovalDeniedError extends Error {
  public constructor(message = "Tool execution was cancelled by the approval policy.") {
    super(message);
    this.name = "ToolApprovalDeniedError";
  }
}

export interface ToolApprovalRequest {
  title: string;
  toolName: string;
  summary?: string;
  reason: string;
}

export interface ToolRouterDependencies {
  toolProviderRegistry: ToolProviderRegistry;
  policyRegistry: ToolPolicyRegistry;
  workspaceRoot: string;
  getApprovalSettings(): ApprovalSettings;
  isWorkspaceTrusted(): boolean;
  requestApproval?(request: ToolApprovalRequest): Promise<boolean>;
  onToolCompleted?(toolName: string, result: ToolResult): Promise<void> | void;
}

export interface RoutedToolRequest {
  toolName: string;
  argumentsPayload?: Record<string, unknown>;
  title?: string;
  approvalSummary?: string;
  forceApproval?: boolean;
}

export class ToolRouter {
  public constructor(private readonly dependencies: ToolRouterDependencies) {}

  public async invokeTool(request: RoutedToolRequest): Promise<ToolResult> {
    const policy = this.dependencies.policyRegistry.resolve(request.toolName);
    const approval = shouldRequireApproval(
      policy,
      this.dependencies.getApprovalSettings(),
      this.dependencies.isWorkspaceTrusted(),
    );

    if ((request.forceApproval || approval.required) && this.dependencies.requestApproval) {
      const approved = await this.dependencies.requestApproval({
        title: request.title ?? policy.title,
        toolName: request.toolName,
        summary: request.approvalSummary,
        reason: approval.reason,
      });
      if (!approved) {
        throw new ToolApprovalDeniedError();
      }
    }

    const result = await this.dependencies.toolProviderRegistry.routeTool(
      request.toolName,
      request.argumentsPayload ?? {},
      this.dependencies.workspaceRoot,
    );
    await this.dependencies.onToolCompleted?.(request.toolName, result);
    return result;
  }
}
