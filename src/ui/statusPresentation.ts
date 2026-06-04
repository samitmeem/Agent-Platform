import type { ServiceHealth } from "../adapters/tokenSavior/protocol";

export type BackendIndicatorState = {
  kind: "idle" | "starting" | "ready" | "error";
  detail?: string;
  health?: ServiceHealth;
};

export function getStatusBarText(state: BackendIndicatorState): string {
  switch (state.kind) {
    case "starting":
      return "$(sync~spin) Agent-Platform";
    case "ready":
      return "$(check) Agent-Platform";
    case "error":
      return "$(error) Agent-Platform";
    case "idle":
    default:
      return "$(circle-slash) Agent-Platform";
  }
}

export function getStatusBarTooltip(state: BackendIndicatorState): string {
  const lines = ["Agent-Platform backend"];

  switch (state.kind) {
    case "starting":
      lines.push(state.detail ?? "Starting or checking backend status...");
      break;
    case "ready":
      if (state.health) {
        lines.push(
          `Ready · v${state.health.version} · profile=${state.health.profile} · capabilities=${state.health.capability_count}`,
        );
      } else {
        lines.push("Ready");
      }
      if (state.detail) {
        lines.push(state.detail);
      }
      break;
    case "error":
      lines.push(state.detail ?? "Backend unavailable");
      break;
    case "idle":
    default:
      lines.push(state.detail ?? "Open a workspace folder to connect.");
      break;
  }

  lines.push("Click to ping the backend.");
  return lines.join("\n");
}
