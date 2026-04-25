import type { ServiceToolResult } from "../backend/protocol";
import type { BackendGateway } from "../backend/gateway";
import type { ApprovalSettings } from "../policies/approvalPolicy";
import { shouldRequireApproval } from "../policies/approvalPolicy";
import { resolveToolPolicy } from "../policies/toolPolicy";

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
  gateway: BackendGateway;
  workspaceRoot: string;
  getApprovalSettings(): ApprovalSettings;
  isWorkspaceTrusted(): boolean;
  requestApproval?(request: ToolApprovalRequest): Promise<boolean>;
  onToolCompleted?(toolName: string, result: ServiceToolResult): Promise<void> | void;
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

  public async invokeTool(request: RoutedToolRequest): Promise<ServiceToolResult> {
    const policy = resolveToolPolicy(request.toolName);
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

    const result = await this.dependencies.gateway.invokeTool(
      this.dependencies.workspaceRoot,
      request.toolName,
      request.argumentsPayload ?? {},
    );
    await this.dependencies.onToolCompleted?.(request.toolName, result);
    return result;
  }
}
