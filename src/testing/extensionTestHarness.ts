import * as vscode from "vscode";

import type { ToolResult } from "../tools/interface";

export interface CommandUi {
  showInformationMessage(message: string): Thenable<string | undefined>;
  showWarningMessage(message: string, options?: vscode.MessageOptions, ...items: string[]): Thenable<string | undefined>;
  showErrorMessage(message: string): Thenable<string | undefined>;
  showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined>;
  showQuickPick<T extends vscode.QuickPickItem>(items: readonly T[], options: vscode.QuickPickOptions): Thenable<T | undefined>;
}

export interface ObservabilityPanelSnapshot {
  viewType: string;
  title: string;
  html: string;
  visible: boolean;
}

export interface ToolInvocationRecord {
  workspaceRoot: string;
  toolName: string;
  argumentsPayload: Record<string, unknown>;
}

type MockToolResponseInput = ToolResult | ToolResult[];

function normalizeResponse(
  workspaceRoot: string,
  toolName: string,
  response: ToolResult,
): ToolResult {
  return {
    name: response.name || toolName,
    ok: response.ok,
    content: response.content,
    error: response.error ?? null,
  };
}

function isCancellationToken(value: string): boolean {
  return value === "__cancel__" || value === "__dismiss__";
}

export class ExtensionTestHarness implements CommandUi {
  private readonly inputBoxResponses: string[] = [];
  private readonly quickPickResponses: string[] = [];
  private readonly warningMessageResponses: string[] = [];
  private readonly toolResponses = new Map<string, ToolResult[]>();
  private readonly toolInvocations: ToolInvocationRecord[] = [];
  private readonly informationMessages: string[] = [];
  private readonly warningMessages: string[] = [];
  private readonly errorMessages: string[] = [];
  private lastObservabilityPanel: ObservabilityPanelSnapshot | undefined;

  public reset(): void {
    this.inputBoxResponses.length = 0;
    this.quickPickResponses.length = 0;
    this.warningMessageResponses.length = 0;
    this.toolResponses.clear();
    this.toolInvocations.length = 0;
    this.informationMessages.length = 0;
    this.warningMessages.length = 0;
    this.errorMessages.length = 0;
    this.lastObservabilityPanel = undefined;
  }

  public enqueueInputBoxResponses(responses: readonly string[]): void {
    this.inputBoxResponses.push(...responses);
  }

  public enqueueQuickPickResponses(responses: readonly string[]): void {
    this.quickPickResponses.push(...responses);
  }

  public enqueueWarningMessageResponses(responses: readonly string[]): void {
    this.warningMessageResponses.push(...responses);
  }

  public setToolResponses(toolName: string, response: MockToolResponseInput): void {
    const responses = Array.isArray(response) ? response : [response];
    this.toolResponses.set(toolName, [...responses]);
  }

  public clearToolResponses(toolName?: string): void {
    if (toolName) {
      this.toolResponses.delete(toolName);
      return;
    }

    this.toolResponses.clear();
  }

  public getToolInvocations(): ToolInvocationRecord[] {
    return [...this.toolInvocations];
  }

  public getLastObservabilityPanel(): ObservabilityPanelSnapshot | undefined {
    return this.lastObservabilityPanel;
  }

  public recordObservabilityPanel(snapshot: ObservabilityPanelSnapshot): void {
    this.lastObservabilityPanel = snapshot;
  }

  public async invokeTool(
    fallback: (workspaceRoot: string, name: string, argumentsPayload?: Record<string, unknown>) => Promise<ToolResult>,
    workspaceRoot: string,
    toolName: string,
    argumentsPayload: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    this.toolInvocations.push({ workspaceRoot, toolName, argumentsPayload });
    const queued = this.toolResponses.get(toolName);
    if (queued && queued.length > 0) {
      const next = queued.shift()!;
      if (queued.length === 0) {
        this.toolResponses.delete(toolName);
      }
      return normalizeResponse(workspaceRoot, toolName, next);
    }

    return fallback(workspaceRoot, toolName, argumentsPayload);
  }

  public showInformationMessage(message: string): Thenable<string | undefined> {
    this.informationMessages.push(message);
    return vscode.window.showInformationMessage(message);
  }

  public showWarningMessage(
    message: string,
    options?: vscode.MessageOptions,
    ...items: string[]
  ): Thenable<string | undefined> {
    this.warningMessages.push(message);
    if (items.length > 0 && this.warningMessageResponses.length > 0) {
      const next = this.warningMessageResponses.shift()!;
      if (isCancellationToken(next)) {
        return Promise.resolve(undefined);
      }

      if (!items.includes(next)) {
        throw new Error(`No queued warning response matched any item for message: ${message}`);
      }

      return Promise.resolve(next);
    }

    return options
      ? vscode.window.showWarningMessage(message, options, ...items)
      : vscode.window.showWarningMessage(message, ...items);
  }

  public showErrorMessage(message: string): Thenable<string | undefined> {
    this.errorMessages.push(message);
    return vscode.window.showErrorMessage(message);
  }

  public showInputBox(options: vscode.InputBoxOptions): Thenable<string | undefined> {
    if (this.inputBoxResponses.length > 0) {
      const next = this.inputBoxResponses.shift()!;
      return Promise.resolve(isCancellationToken(next) ? undefined : next);
    }

    return vscode.window.showInputBox(options);
  }

  public showQuickPick<T extends vscode.QuickPickItem>(
    items: readonly T[],
    options: vscode.QuickPickOptions,
  ): Thenable<T | undefined> {
    if (this.quickPickResponses.length > 0) {
      const next = this.quickPickResponses.shift()!;
      if (isCancellationToken(next)) {
        return Promise.resolve(undefined);
      }

      const match = items.find((item) => item.label === next || item.description === next || item.detail === next);
      if (!match) {
        throw new Error(`No queued quick-pick response matched any item for prompt: ${options.placeHolder ?? "<unknown>"}`);
      }

      return Promise.resolve(match);
    }

    return vscode.window.showQuickPick(items, options);
  }
}

export const defaultCommandUi: CommandUi = {
  showInformationMessage: (message) => vscode.window.showInformationMessage(message),
  showWarningMessage: (message, options, ...items) => (options
    ? vscode.window.showWarningMessage(message, options, ...items)
    : vscode.window.showWarningMessage(message, ...items)),
  showErrorMessage: (message) => vscode.window.showErrorMessage(message),
  showInputBox: (options) => vscode.window.showInputBox(options),
  showQuickPick: (items, options) => vscode.window.showQuickPick(items, options),
};