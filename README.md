# Token Savior Agent — VS Code Extension

A VS Code extension that connects to the MCPs
Python backend to provide project-wide code intelligence, safe mutation workflows,
checkpoints, memory, and observability.

---

## Architecture

```
User (VS Code chat / command palette)
        ↓
VS Code Extension  ← this project
        ↓
Agent Layer (planning + multi-step loop)
        ↓
Tool Router (approval-gated, policy-controlled)
        ↓
Backend Gateway (JSON-RPC over stdio)
        ↓
token-savior Python backend (separate install)
        ↓
LLM Layer (GitHub Copilot or local Ollama / OpenAI-compatible)
```

The extension owns the control plane. The LLM is used **only** for planning decisions,
never as an orchestrator. The Python backend provides all tool execution.

---

## Prerequisites

1. **VS Code 1.99+**
2. **GitHub Copilot** (for the default model provider) or a local Ollama / OpenAI-compatible runtime
3. **token-savior Python backend** installed in the workspace:

```bash
pip install token-savior
# or with uv:
uv add token-savior
```

---

## Quick Start

1. Install the extension from the VS Code Marketplace (search *Token Savior Agent*)
   or install the `.vsix` manually via **Extensions: Install from VSIX...**
2. Open a project folder that has the token-savior backend installed.
3. The extension auto-starts the backend. Status appears in the bottom-left status bar.
4. Use the chat participant: `@token-savior what is this project?`
5. Or open the Command Palette and run **Token Savior: Project Summary**.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `tokenSaviorAgent.pythonPath` | auto-detect | Path to the Python executable |
| `tokenSaviorAgent.serviceModule` | `token_savior.service_api.server` | Backend module |
| `tokenSaviorAgent.modelProvider` | `copilot` | `copilot` or `local` |
| `tokenSaviorAgent.copilotModelFamily` | | Optional Copilot model family |
| `tokenSaviorAgent.localEndpoint` | `http://127.0.0.1:11434` | Local model base URL |
| `tokenSaviorAgent.localModelName` | | Local model name (e.g. `llama3.1:8b`) |
| `tokenSaviorAgent.localApiFormat` | `ollama` | `ollama` or `openai` |
| `tokenSaviorAgent.editApprovalMode` | `ask` | `ask` / `allow` |
| `tokenSaviorAgent.testApprovalMode` | `allow-trusted` | `ask` / `allow` / `allow-trusted` |
| `tokenSaviorAgent.commandApprovalMode` | `allow-trusted` | `ask` / `allow` / `allow-trusted` |
| `tokenSaviorAgent.destructiveApprovalMode` | `ask` | `ask` / `allow` |
| `tokenSaviorAgent.autoSaveProjectMemory` | `false` | Auto-save runs to project memory |
| `tokenSaviorAgent.toolTimeoutMs` | `30000` | Per-tool call timeout (ms) |
| `tokenSaviorAgent.maxContextTokens` | `8000` | Token budget for context injection |

---

## Development

```powershell
npm install
npm run compile      # one-shot build
npm run watch        # watch mode
npm test             # unit tests (Node test runner)
npm run test:extension-host   # extension host integration tests
```

### Publishing

```powershell
$env:VSCE_PAT = "your-pat-here"
npm run package       # builds .vsix in .artifacts/
npm run publish:vsce  # publishes to the VS Code Marketplace
npm run publish:ovsx  # publishes to Open VSX (optional)
```

---

## Fixes applied vs. monorepo v0.1.0

| ID | Fix |
|----|-----|
| FIX-1 | `copilotProvider.ts` uses `LanguageModelChatMessage.System` |
| FIX-2 | Context window budget enforced |
| FIX-3 | JSON extraction: fenced block first, warning on brace-scan fallback |
| FIX-4 | Tool call timeout via `Promise.race` (configurable) |
| FIX-5 | Agent loop: per-step try/catch, clean error messages |
| FIX-6 | Dynamic tool discovery via `capabilities.list` |
| FIX-7 | Backend reconnect: exponential backoff (3 retries) |
| FIX-8 | Cancellation: AbortController polled from VS Code CancellationToken |
| FIX-9 | Error signalling: `ok/error` fields, not string prefix |
| FIX-10 | Compact Memento storage for run history |

---

## License

MIT
