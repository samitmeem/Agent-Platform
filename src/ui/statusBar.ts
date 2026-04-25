import * as vscode from "vscode";

import type { ServiceHealth } from "../adapters/tokenSavior/protocol";
import {
  getStatusBarText,
  getStatusBarTooltip,
  type BackendIndicatorState,
} from "./statusPresentation";

export class BackendStatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  public constructor(command = "tokenSaviorAgent.pingBackend") {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = command;
    this.item.name = "Token Savior Backend";
    this.item.show();
    this.setIdle();
  }

  public setIdle(detail?: string): void {
    this.apply({ kind: "idle", detail });
  }

  public setStarting(detail?: string): void {
    this.apply({ kind: "starting", detail });
  }

  public setReady(health?: ServiceHealth, detail?: string): void {
    this.apply({ kind: "ready", health, detail });
  }

  public setError(detail?: string): void {
    this.apply({ kind: "error", detail });
  }

  public dispose(): void {
    this.item.dispose();
  }

  private apply(state: BackendIndicatorState): void {
    this.item.text = getStatusBarText(state);
    this.item.tooltip = getStatusBarTooltip(state);
  }
}