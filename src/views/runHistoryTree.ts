import * as vscode from "vscode";

import type { AgentTraceEntry } from "../agent/trace";
import {
  formatStoredPreviewRunBody,
  toPreviewRunListItem,
} from "../state/sessionPresentation";
import type { SessionStore, StoredPreviewRun } from "../state/sessionStore";

interface PreviewRunNode {
  kind: "run";
  run: StoredPreviewRun;
}

interface TraceEntryNode {
  kind: "trace";
  run: StoredPreviewRun;
  entry: AgentTraceEntry;
}

interface EmptyStateNode {
  kind: "empty";
  label: string;
  description?: string;
}

type RunHistoryTreeNode = PreviewRunNode | TraceEntryNode | EmptyStateNode;

export class AgentRunHistoryTreeProvider
implements vscode.TreeDataProvider<RunHistoryTreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<RunHistoryTreeNode | undefined>();
  private readonly unsubscribe: () => void;

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(private readonly sessionStore: SessionStore) {
    this.unsubscribe = this.sessionStore.subscribe(() => {
      this.refresh();
    });
  }

  public dispose(): void {
    this.unsubscribe();
    this.changeEmitter.dispose();
  }

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  public getTreeItem(element: RunHistoryTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "run": {
        const item = toPreviewRunListItem(element.run);
        const treeItem = new vscode.TreeItem(
          item.label,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        treeItem.id = element.run.id;
        treeItem.description = item.description;
        treeItem.tooltip = formatStoredPreviewRunBody(element.run);
        treeItem.contextValue = "previewRun";
        treeItem.command = {
          command: "tokenSaviorAgent.showStoredAgentRun",
          title: "Show Agent Run",
          arguments: [element.run.id],
        };
        return treeItem;
      }
      case "trace": {
        const detail = element.entry.data && Object.keys(element.entry.data).length > 0
          ? JSON.stringify(element.entry.data)
          : undefined;
        const treeItem = new vscode.TreeItem(
          `${element.entry.step}. [${element.entry.phase}] ${element.entry.message}`,
          vscode.TreeItemCollapsibleState.None,
        );
        treeItem.description = detail;
        treeItem.tooltip = detail
          ? `${element.entry.message}\n${detail}`
          : element.entry.message;
        treeItem.contextValue = "previewRunTrace";
        treeItem.command = {
          command: "tokenSaviorAgent.showStoredAgentRun",
          title: "Show Agent Run",
          arguments: [element.run.id],
        };
        return treeItem;
      }
      case "empty": {
        const treeItem = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.None,
        );
        treeItem.description = element.description;
        treeItem.contextValue = "empty";
        return treeItem;
      }
    }
  }

  public getChildren(element?: RunHistoryTreeNode): Thenable<RunHistoryTreeNode[]> {
    if (!element) {
      const runs = this.sessionStore.listPreviewRuns();
      if (runs.length === 0) {
        return Promise.resolve([
          {
            kind: "empty",
            label: "No preview runs yet",
            description: "Run the preview agent to populate this view.",
          },
        ]);
      }

      return Promise.resolve(runs.map((run) => ({ kind: "run", run })));
    }

    if (element.kind === "run") {
      if (element.run.result.trace.length === 0) {
        return Promise.resolve([
          {
            kind: "empty",
            label: "No trace entries",
            description: "This run did not record trace steps.",
          },
        ]);
      }

      return Promise.resolve(
        element.run.result.trace.map((entry) => ({
          kind: "trace",
          run: element.run,
          entry,
        })),
      );
    }

    return Promise.resolve([]);
  }
}