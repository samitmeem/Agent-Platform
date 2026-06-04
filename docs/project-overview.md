# Agent-Platform — VS Code Extension

## What it is

A VS Code extension (`publisher: samitmeem`) that connects to an optional Python backend called `token-savior` to provide AI-powered, safe code mutation workflows inside VS Code.

---

## How it works

The architecture is a layered pipeline:

```
User (VS Code chat / command palette)
  → VS Code Extension (this project — TypeScript)
    → Agent Layer  (planning + multi-step loop)
      → Tool Router  (approval-gated, policy-controlled)
        → Backend Gateway  (JSON-RPC over stdio)
          → token-savior Python backend  (separate pip package)
            → LLM Layer  (GitHub Copilot or local Ollama / OpenAI-compatible)
```

Key design principle: **the extension owns the control plane**. The LLM is only used for planning decisions — never as an orchestrator. All tool execution runs through the Python backend.

---

## Main subsystems (`src/`)

| Folder | Purpose |
|---|---|
| `agent/` | Planner, runtime loop, tool routing, context budgeting, memory bridge |
| `backend/` | JSON-RPC gateway to the Python backend process |
| `chat/` | VS Code `@agent-platform` chat participant |
| `commands/` | Command palette entries (ping, restart, etc.) |
| `policies/` | Approval policies (edit/test/command/destructive gating) |
| `providers/` | LLM providers — Copilot and local Ollama/OpenAI-compatible |
| `state/` | Session store, workspace store, telemetry |
| `ui/` | Status bar controller |
| `views/` | Observability panel, run history tree |

---

## GitHub Repository

- **Repo:** https://github.com/samitmeem/Agent-Platform
- **Issues:** https://github.com/samitmeem/Agent-Platform/issues
- **Homepage:** https://github.com/samitmeem/Agent-Platform#readme

The VS Code extension lives in `samitmeem/Agent-Platform`, while the optional Python backend remains the `token-savior` pip package. The extension is currently at version `0.2.0` and marked as preview.
