# Agent-Platform

> A dynamic agent platform for VS Code — plug in any tool provider, let the LLM plan, and execute safely with full approval control.

Agent-Platform is a VS Code extension that turns your editor into an extensible AI agent runtime. Tool providers are registered dynamically at startup. The LLM discovers them through a live manifest and selects the right tool per request — no hardcoded logic required. The system works with or without a backend; in no-tools mode it answers directly from context.

---

## Key Features

- **Dynamic tool discovery** — register any `ToolProvider` at runtime; the agent picks up new tools automatically
- **Generic planning layer** — the LLM selects tools based on descriptions, not hardcoded names
- **Memory abstraction** — session history and project memory are resolved through a capability interface, not string literals
- **Conditional backend** — the Python backend is optional; disable it with one config flag to run in LLM-only mode
- **Approval-gated execution** — every tool class (edit, test, command, destructive) has its own configurable approval policy
- **Multi-step reasoning** — the agent chains tool calls across up to N steps, merging results into a single answer
- **Observability** — full per-run trace, run history panel, and an observability dashboard

---

## Architecture

```
┌─────────────────────────────────────────┐
│  User  (chat participant / command palette) │
└──────────────────┬──────────────────────┘
                   │
         ┌─────────▼──────────┐
         │   Agent Runtime     │  planning loop, multi-step execution
         │   + Memory Bridge   │  session history, project memory
         └─────────┬──────────┘
                   │  listTools() → live manifest → LLM prompt
         ┌─────────▼──────────┐
         │  ToolProviderRegistry │  routes calls to registered providers
         └──┬──────────────┬──┘
            │              │
   ┌────────▼───┐   ┌──────▼──────────────┐
   │  Provider A │   │  Provider B (Python) │  any number of providers
   │  (mock/custom)  │  JSON-RPC over stdio │
   └────────────┘   └─────────────────────┘
                   │
         ┌─────────▼──────────┐
         │  LLM Layer          │  GitHub Copilot  or  local Ollama / OpenAI
         └────────────────────┘
```

The extension owns the control plane. The LLM is used **only** for planning — never as an orchestrator. Tool execution is always deterministic and approval-gated.

---

## Prerequisites

- **VS Code 1.99+**
- **GitHub Copilot** (default) or a local Ollama / OpenAI-compatible runtime
- *(Optional)* A Python tool backend installed in the workspace:

```bash
pip install token-savior
# or with uv:
uv add token-savior
```

The extension runs without any backend. Set `agentPlatform.backend.enabled: false` to operate in LLM-only mode.

---

## Quick Start

1. Install from the VS Code Marketplace (search **Agent-Platform**) or install the `.vsix` via **Extensions: Install from VSIX...**
2. Open a workspace folder.
3. Use the chat participant:
   ```
   @agent-platform what is this project?
   @agent-platform /summary
   @agent-platform /symbol MyClass
   ```
4. Or open the Command Palette (`Ctrl+Shift+P`) and run any **Agent-Platform:** command.

---

## Chat Commands

| Command | Description |
|---------|-------------|
| `/summary` | Summarize the current project |
| `/symbol` | Analyze a symbol with full context |
| `/dependencies` | Inspect what a symbol depends on |
| `/impact` | Show the change impact of a symbol |
| `/memory` | Search project memory for relevant notes |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `agentPlatform.backend.enabled` | `true` | Enable the Python backend provider. Set `false` for LLM-only mode |
| `agentPlatform.pythonPath` | auto-detect | Path to the Python executable |
| `agentPlatform.serviceModule` | `token_savior.service_api.server` | Python backend module |
| `agentPlatform.modelProvider` | `copilot` | `copilot` or `local` |
| `agentPlatform.copilotModelFamily` | | Optional Copilot model family |
| `agentPlatform.localEndpoint` | `http://127.0.0.1:11434` | Local model base URL |
| `agentPlatform.localModelName` | | Local model name (e.g. `llama3.1:8b`) |
| `agentPlatform.localApiFormat` | `ollama` | `ollama` or `openai` |
| `agentPlatform.editApprovalMode` | `ask` | Approval policy for file edits |
| `agentPlatform.testApprovalMode` | `allow-trusted` | Approval policy for test runs |
| `agentPlatform.commandApprovalMode` | `allow-trusted` | Approval policy for project actions |
| `agentPlatform.destructiveApprovalMode` | `ask` | Approval policy for destructive operations |
| `agentPlatform.autoSaveProjectMemory` | `false` | Auto-save eligible runs to project memory |
| `agentPlatform.toolTimeoutMs` | `30000` | Per-tool call timeout (ms) |
| `agentPlatform.maxContextTokens` | `8000` | Token budget for context injection into planning prompts |

---

## Extending with Custom Tool Providers

Any object implementing `ToolProvider` can be registered:

```typescript
import { ToolProviderRegistry } from "./tools/providerRegistry";
import type { ToolProvider, ToolDefinition, ToolResult } from "./tools/interface";

const myProvider: ToolProvider = {
  id: "my-provider",
  displayName: "My Provider",
  async isAvailable() { return true; },
  async listTools(): Promise<ToolDefinition[]> {
    return [{
      name: "echo_tool",
      category: "utility",
      description: "Returns the input text unchanged.",
      safetyClass: "read",
      mutatesWorkspace: false,
      requiresApprovalByDefault: false,
    }];
  },
  async invokeTool(name, args): Promise<ToolResult> {
    return { name, ok: true, content: [String(args["text"] ?? "")] };
  },
  async dispose() {},
};

registry.registerProvider(myProvider);
// The agent now discovers echo_tool automatically — no code changes needed.
```

---

## Development

```powershell
npm install
npm run compile        # one-shot build
npm run watch          # watch mode
npm test               # unit tests  (Node test runner, no VS Code required)
npm run test:extension-host   # extension host integration tests
```

### Running the platform validation tests

```powershell
npm run compile
node --test out/test/platformValidation.test.js out/test/platformValidationExtended.test.js
```

These 8 tests prove dynamic tool discovery, no-tools mode, multi-tool reasoning, and tool replacement — all without modifying core code.

### Publishing

```powershell
$env:VSCE_PAT = "your-pat-here"
npm run package        # builds .vsix in .artifacts/
npm run publish:vsce   # publishes to the VS Code Marketplace
npm run publish:ovsx   # publishes to Open VSX (optional)
```

---

## Platform Validation

8 automated tests prove the system is a true dynamic agent platform:

| Test | Proof |
|------|-------|
| 1 — New tool integration | A new `echo_tool` registers, appears in the manifest, and is executed — zero core changes |
| 2 — No-tools mode | Agent answers correctly with no providers registered; no crashes |
| 3 — Dynamic planning | Model picks `echo_tool` vs `uppercase_tool` based on description alone |
| 4 — Remove backend | System works with token-savior never registered |
| 5 — External tools | Code summarizer, dependency analyzer, workflow executor register and route correctly |
| 6 — Multi-tool reasoning | Agent chains two tools and merges results into one answer |
| 7 — 12 tools at scale | All 12 tools appear in the manifest; correct tool selected |
| 8 — Tool replacement | Old tool removed, new tool registered; runtime uses it with zero code changes |

---

## License

MIT — [samitmeem/Agent-Platform](https://github.com/samitmeem/Agent-Platform)
