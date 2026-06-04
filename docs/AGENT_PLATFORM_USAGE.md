# Agent-Platform Usage Guide

**Version:** 0.1.0 (Beta)  
**Status:** Early access — suitable for real development workflows with awareness of current limitations

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [How It Works](#2-how-it-works)
3. [Installation and Setup](#3-installation-and-setup)
4. [First Run](#4-first-run)
5. [Core Features](#5-core-features)
6. [Example Use Cases](#6-example-use-cases)
7. [How Tools Work](#7-how-tools-work)
8. [Modes of Operation](#8-modes-of-operation)
9. [Troubleshooting](#9-troubleshooting)
10. [Best Practices](#10-best-practices)
11. [Limitations](#11-limitations)
12. [Implementation Plan Template](#12-implementation-plan-template)

---

## 1. Introduction

### What this system is

Agent-Platform is a VS Code extension that connects an AI planning layer to a set of structured tools for understanding and modifying your codebase. When you ask it a question or give it a task, it does not guess from memory alone. It queries your actual project — finding symbols, tracing dependencies, running tests — and then synthesizes the results into a direct answer.

### What problems it solves

Standard AI chat assistants in VS Code operate from a static snapshot of your codebase. They cannot navigate your project dynamically, run queries against it, or execute actions safely within guardrails. Agent-Platform addresses this by:

- Letting the AI select and invoke the right tool for your question automatically
- Chaining multiple steps together when a single tool call is not enough
- Requiring explicit approval before any file edit, test run, or destructive operation
- Keeping a session history and project memory so context is not lost between runs

### How it differs from normal Copilot usage

| Standard Copilot Chat | Agent-Platform |
|---|---|
| Answers from pre-trained knowledge and open files | Queries the live project structure to answer |
| No awareness of actual symbol dependencies | Traces real call graphs and dependency chains |
| No concept of safe mutation | Approval gates every file edit, test run, and action |
| Stateless per message | Maintains session history and project memory across runs |
| Single LLM response | Multi-step reasoning — chains tool calls to build the answer |

You still interact through the familiar VS Code chat interface. The difference is what happens behind your message.

---

## 2. How It Works

The flow for every request follows four stages:

```
User message
     |
     v
Planning — the agent reads your query and decides which tool (if any) to invoke
     |
     v
Tool execution — the tool queries or modifies your project (with approval if needed)
     |
     v
Follow-up — the agent checks the result; if more steps are needed, it loops back
     |
     v
Answer — the final synthesized response is streamed back to chat
```

The AI model is used only for planning — deciding what to do. Execution is always deterministic: the tool runs against your actual project files and returns structured data. The model then summarizes and presents the result.

If the backend is not running, or if no tool matches your query, the agent answers directly from the model's knowledge. It never silently fails — it always returns a response.

---

## 3. Installation and Setup

### Prerequisites

- **VS Code 1.99 or later**
- **GitHub Copilot** active in VS Code (required for the default model provider)
- **Python 3.10 or later** — only if you plan to use the backend tool provider

### Installing the extension

Install from the VS Code Marketplace by searching for **Agent-Platform**, or install a `.vsix` package manually:

1. Open the Command Palette: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
2. Run: `Extensions: Install from VSIX...`
3. Select the `.vsix` file

### Installing the Python backend (optional)

The Python backend provides deep code-intelligence tools: symbol lookup, dependency tracing, change impact analysis, test execution, and more. Without it, the agent operates in direct-answer mode using the model only.

```bash
pip install token-savior
```

Or with `uv`:

```bash
uv add token-savior
```

### Enabling or disabling the backend

Open VS Code Settings (`Ctrl+,`) and search for **Agent-Platform**.

| Setting | Default | Effect |
|---|---|---|
| `agentPlatform.backend.enabled` | `true` | Starts the Python backend on extension activation. Set to `false` to run without any tool provider |
| `agentPlatform.pythonPath` | auto-detect | Absolute path to the Python executable if auto-detection fails |

To disable the backend entirely for a workspace, add this to `.vscode/settings.json`:

```json
{
  "agentPlatform.backend.enabled": false
}
```

### Using a local model instead of Copilot

If you prefer Ollama or any OpenAI-compatible server:

```json
{
  "agentPlatform.modelProvider": "local",
  "agentPlatform.localEndpoint": "http://127.0.0.1:11434",
  "agentPlatform.localModelName": "llama3.1:8b",
  "agentPlatform.localApiFormat": "ollama"
}
```

---

## 4. First Run

### Step 1 — Open your project

Open any workspace folder in VS Code. The extension activates automatically when VS Code starts.

### Step 2 — Check the status bar

Look at the bottom status bar. You will see an **Agent-Platform** indicator showing the backend state:
- `Starting` — backend is launching
- `Ready` — backend is running and tools are available
- `Stopped` — backend is not running; the agent will answer from the model only

### Step 3 — Open the chat panel

Press `Ctrl+Alt+I` or click the chat icon in the Activity Bar to open the VS Code chat panel.

### Step 4 — Address the agent

Type `@agent-platform` followed by your question. The `@agent-platform` prefix routes your message to this extension instead of default Copilot.

Example:

```
@agent-platform what is this project?
```

### Step 5 — Watch the response

As the agent works, you will see progress messages in the chat:
- `Running \`get_project_summary\`...` — a tool is executing
- `Summarizing results...` — the agent is combining outputs into a final answer

The final answer appears once all steps complete.

### Step 6 — Approving tool actions

If you ask the agent to do something that modifies your project (edit a file, run tests, execute an action), a VS Code approval dialog appears before anything changes. You can allow or deny each operation individually.

---

## 5. Core Features

### Code understanding

The agent can find any symbol in your project, explain what it does, and show where it is used.

**Example prompts:**
```
@agent-platform find the UserAuthService class
@agent-platform explain what the validate_token function does
@agent-platform /symbol PaymentProcessor
```

### Dependency analysis

Given a symbol name, the agent traces what it depends on and returns the full dependency chain.

**Example prompts:**
```
@agent-platform what does OrderService depend on?
@agent-platform show dependencies for the checkout function
@agent-platform /dependencies CartRepository
```

### Change impact analysis

Before changing anything, ask the agent what would break if you modified a symbol.

**Example prompts:**
```
@agent-platform what breaks if I change the authenticate method?
@agent-platform blast radius for renaming UserSession
@agent-platform /impact parseConfig
```

### Project analysis

Get a high-level summary of the project structure, purpose, and key components.

**Example prompts:**
```
@agent-platform summarize this project
@agent-platform what is this codebase?
@agent-platform /summary
```

### Multi-step reasoning

For complex questions, the agent chains multiple tool calls. For example, to answer "what calls parseConfig and what would break if I changed it?", the agent might run a symbol lookup, then a dependency query, then an impact analysis — and merge all results into one answer. You do not need to manage these steps.

### Project actions

Discover and run named project actions (build, lint, test suites) through the agent.

**Example prompts:**
```
@agent-platform what actions can I run in this project?
@agent-platform run the lint action
@agent-platform /summary (to see available actions listed)
```

### Memory

If project memory is enabled, the agent can recall previous runs and notes tied to this workspace.

**Example prompts:**
```
@agent-platform search memory for notes about the database layer
@agent-platform /memory authentication
```

To save a run to memory manually, open the Command Palette and run:
`Agent-Platform: Save Last Run to Memory`

To enable automatic saving:

```json
{
  "agentPlatform.autoSaveProjectMemory": true
}
```

---

## 6. Example Use Cases

### Use case 1: Understand an unfamiliar codebase

**Prompt:**
```
@agent-platform what is this project and how is it structured?
```

**What the agent does:**
1. Invokes the project summary tool against your workspace
2. Retrieves the top-level structure, entry points, and key components
3. Returns a concise plain-text overview

**Expected output:**  
A paragraph description of what the project does, followed by a structured list of the main modules, their roles, and notable patterns.

---

### Use case 2: Find where a function is used

**Prompt:**
```
@agent-platform find all places that call the sendEmail function
```

**What the agent does:**
1. Looks up the `sendEmail` symbol
2. Queries for call sites and callers across the codebase
3. Returns a list of locations with context

**Expected output:**  
A list of files and locations where `sendEmail` is invoked, with surrounding context for each site.

---

### Use case 3: Analyze the impact of a change

**Prompt:**
```
@agent-platform what would break if I rename the DatabaseConnection class?
```

**What the agent does:**
1. Looks up `DatabaseConnection` and its current usages
2. Runs a change impact analysis to find direct and transitive dependents
3. Returns a prioritized list of what would be affected

**Expected output:**  
A breakdown of files and symbols that directly import or use `DatabaseConnection`, followed by transitive dependents that would be indirectly affected.

---

### Use case 4: Run impacted tests after a change

**Prompt:**
```
@agent-platform run the tests that cover the PaymentService class
```

**What the agent does:**
1. Identifies which test files cover `PaymentService`
2. Requests your approval before executing
3. Runs only the impacted tests (not the full suite)
4. Returns the pass/fail result with output

**Expected output:**  
Test results for the impacted subset, with pass count, any failures, and relevant output lines.

---

### Use case 5: Apply a change safely

**Prompt (with code selected in the editor):**
```
@agent-platform apply this selected implementation to the processOrder function
```

**What the agent does:**
1. Identifies the `processOrder` symbol in your project
2. Requests approval to apply the selected text as its new implementation
3. Applies the change and immediately runs impacted tests to validate it
4. Reports whether the change passed validation; rolls back automatically on failure

**Expected output:**  
Confirmation that the change was applied and validation passed, or a rollback notice with the failure details.

---

## 7. How Tools Work

### You do not choose tools

You write a plain natural-language question. The agent reads the question, looks at all available tools and their descriptions, and selects the most appropriate one automatically. You never need to specify a tool name or know that tools exist.

### Tool selection is adaptive

If the optimal tool is not available (backend is stopped, provider is disconnected), the agent falls back to the next best option — either a different registered tool that partially matches your request, or a direct answer from the model. The agent will tell you when it is operating without tools.

### Fallback behavior

When a tool call fails:
1. The agent detects the failure
2. For transient errors (network timeout, connection reset), it retries once automatically
3. If the retry fails, or the error is permanent (tool not found, invalid arguments), the agent reports the failure and either selects a different approach or answers directly from context

You will always receive a response. The agent never silently drops your request.

### Approval gates

Some tools modify your workspace. These are always gated behind an explicit approval step:

| Tool class | Default approval |
|---|---|
| File edits | Ask every time |
| Test runs | Allow trusted actions automatically |
| Project actions (build, lint) | Allow trusted actions automatically |
| Destructive operations (checkpoint restore) | Ask every time |

You can change these policies in Settings under the `agentPlatform.*ApprovalMode` keys.

---

## 8. Modes of Operation

### With backend enabled (default)

When `agentPlatform.backend.enabled` is `true` and the Python package is installed, the extension starts a background backend process at startup. This process provides the full set of code-intelligence tools:

- Symbol lookup and full context retrieval
- Dependency and change impact analysis
- Impacted test execution
- Project action discovery and execution
- Safe symbol mutation with rollback
- Checkpoint creation and restore
- Project memory storage and search

In this mode, the agent uses tools as its primary information source. The LLM summarizes tool output rather than guessing from training data, so answers reflect your actual code.

The status bar shows `Ready` when the backend is running.

### Without backend (LLM-only mode)

When `agentPlatform.backend.enabled` is `false`, or when the backend fails to start, the agent operates without any tool providers. In this mode:

- All responses come directly from the model's knowledge
- No live project queries are performed
- No file edits, test runs, or project actions are available
- Answers about your specific codebase are based on what is visible in open files and context

This mode is useful when:
- You do not have Python available
- You are working on a machine where the backend cannot be installed
- You want fast responses for general questions that do not require project introspection

The status bar shows `Stopped` in this mode.

### Switching modes

Toggle the backend on or off without restarting VS Code:

- Open the Command Palette and run `Agent-Platform: Restart Backend` to reconnect
- Or set `agentPlatform.backend.enabled` to `false` in Settings and reload the window

---

## 9. Troubleshooting

### Backend not starting

**Symptom:** Status bar shows `Stopped` or `Error` after VS Code opens.

**Steps:**
1. Open the Command Palette and run `Agent-Platform: Ping Backend` to check connectivity
2. Open the Output panel (`View > Output`) and select `Agent-Platform` from the dropdown — look for startup error messages
3. Verify the Python package is installed: run `python -m token_savior.service_api.server --check` in a terminal
4. If Python is not on the PATH, set `agentPlatform.pythonPath` to the absolute path of your Python executable
5. Run `Agent-Platform: Restart Backend` from the Command Palette to attempt a fresh start

### No tools being used

**Symptom:** The agent answers every question from the model without invoking any tools. The chat shows no `Running tool...` messages.

**Steps:**
1. Confirm `agentPlatform.backend.enabled` is `true` in Settings
2. Check the status bar — if it shows `Stopped`, the backend is not running (see above)
3. Run `Agent-Platform: Show Provider Status` from the Command Palette to inspect registered providers
4. If the provider list is empty, restart the backend

### Slow responses

**Symptom:** Tool calls take 20–30 seconds; responses feel sluggish.

**Steps:**
1. Large projects with many files take longer to analyze — this is expected on first run after indexing
2. Run `Agent-Platform: Reindex Workspace` to rebuild the project index
3. Increase the tool timeout if queries are timing out: set `agentPlatform.toolTimeoutMs` to `60000` or higher
4. Reduce `agentPlatform.maxContextTokens` if planning prompts are large (default is `8000`)
5. If using a local model, ensure your Ollama instance or OpenAI-compatible server is responsive

### Incorrect or outdated answers

**Symptom:** The agent returns information about symbols or files that no longer exist, or misses recently added code.

**Steps:**
1. Run `Agent-Platform: Reindex Workspace` — the project index may be stale
2. For memory-based answers, check whether old runs are influencing the response — use `Agent-Platform: Search Project Memory` to inspect stored notes, and clear outdated ones if needed
3. Reduce `agentPlatform.maxContextTokens` if too much old context is being injected into prompts

### Approval dialog not appearing for edits

**Symptom:** A file edit was applied without showing an approval prompt.

**Steps:**
1. Check `agentPlatform.editApprovalMode` — if it is set to `allow`, edits bypass the dialog
2. Set it back to `ask` to restore approval prompts for all file edits

---

## 10. Best Practices

### Writing better prompts

**Include the symbol name when you can.**  
The agent uses symbol names to anchor queries. Vague references like "the main function" work less reliably than `the processOrder function in OrderService`.

**Be specific about what you want.**  
`explain what this does` is less precise than `show the dependencies of AuthService and explain each one`. Specific requests lead to direct tool selection and faster answers.

**Use slash commands for common tasks.**  
`/summary`, `/symbol`, `/dependencies`, `/impact`, and `/memory` are recognized shorthand that routes directly to the right tool without waiting for the planner to decide.

**Reference the active file when relevant.**  
If you have a file open and want to ask about it, mention the filename. The agent receives the active file path and uses it as context for symbol extraction.

### When to rely on tools vs direct answers

Use tool-backed queries when you need:
- Precise information about your actual code (symbol locations, real dependencies, test results)
- Answers that depend on the current state of the project
- Safe execution of project actions

Use direct-answer mode (or no-backend mode) when you need:
- General explanations of concepts or patterns
- Help with code you paste directly into the chat
- Quick answers that do not require project introspection

### Avoiding large context issues

The agent caps context injection at `agentPlatform.maxContextTokens` (default 8000 tokens). For large projects:
- Keep queries focused on one symbol or one area at a time
- Avoid asking for a full analysis of the entire codebase in a single message — break it into parts
- If tool results are being truncated, try a narrower query (e.g., limit dependency depth)

### Using memory effectively

Project memory persists facts about your codebase across sessions. Use it deliberately:
- After completing a significant analysis run, save it: `Agent-Platform: Save Last Run to Memory`
- Before starting work in an unfamiliar area, ask: `@agent-platform /memory <area name>`
- Clear outdated memory entries periodically to avoid stale context

### Managing approvals

For regular development workflows where you trust the actions being taken, you can set test and command approval modes to `allow`:

```json
{
  "agentPlatform.testApprovalMode": "allow",
  "agentPlatform.commandApprovalMode": "allow"
}
```

Keep `agentPlatform.editApprovalMode` and `agentPlatform.destructiveApprovalMode` at `ask` unless you have a specific reason to bypass them.

---

## 11. Limitations

### Not always correct

The agent uses an LLM to plan and summarize. LLMs make mistakes. Even when a tool returns accurate data, the summarization step may introduce errors, omit details, or misinterpret ambiguous results. Always verify critical answers against your actual code.

### Tool failures are possible

The Python backend can fail to start, time out, or return errors for complex queries. The agent handles these gracefully and falls back to a direct answer, but the direct answer will not have the accuracy of a tool-backed response. Check the Output panel when something seems wrong.

### LLM context limits

Planning prompts are capped at `agentPlatform.maxContextTokens` (default 8000 tokens). For very large projects or queries with extensive history, some context will be truncated. This can cause the planner to miss relevant tool results from earlier steps in a long session.

### Multi-step reasoning has a step limit

The agent runs at most a small number of tool-call steps per request (typically 2–3 steps in preview mode). For queries that would require many sequential steps, the agent will stop and return a partial answer. Break complex multi-part questions into separate, focused requests.

### Large project constraints

Project indexing and dependency analysis scale with codebase size. On very large repositories (millions of lines), initial indexing takes significant time, some queries may time out, and results may be incomplete. Increase `agentPlatform.toolTimeoutMs` and prefer narrower, symbol-scoped queries over broad project-wide questions.

### Memory is not a database

Project memory stores text summaries, not live code references. A memory entry saved today may describe a symbol that was refactored or deleted tomorrow. Treat memory as a starting point for investigation, not as a source of truth. Always confirm memory-based answers against the current state of the project.

### Beta status

This extension is at version 0.1.0 and marked as a preview release. APIs, configuration keys, tool behavior, and output formats may change between releases. Do not build critical automation on top of the current interface without accounting for breaking changes.

---

## 12. Implementation Plan Template

Use this template before implementing any feature or change. Fill every field before asking Copilot or Agent-Platform to begin implementation. The four per-task fields are non-optional — do not begin a task if any field is blank or vague.

**Enforcement rules:**
1. **Scope** — list files explicitly (max 3). If a task touches more than 3 files, decompose it first.
2. **Validate** — must be an executable command or measurable condition. Prose descriptions are not valid.
3. **Review** — read the full diff before marking any task complete. This is not optional.
4. **Checkpoint** — create a checkpoint (via `create_checkpoint`) before any task that touches 2+ files or modifies shared state.

```markdown
# Feature: {Title}

## Summary
{1-2 sentences: what changes and why}

## Mission
{The core goal in one clear statement}

## Success Criteria
- [ ] {Specific, testable criterion}
- [ ] All validation commands pass
- [ ] No regressions in existing tests
- [ ] Full diff reviewed for every task

## Scope
### In Scope
- {What we ARE building}
### Out of Scope
- {What we are NOT building — and why}

## Constraints
- {e.g. mobile-first, API contract must not change, response time under 200ms}
- {performance limits, browser targets, accessibility requirements}

## Codebase Context
| File | Role | Action |
|------|------|--------|
| `{path}` | {what it does} | CREATE / UPDATE |

## Architecture
- {Decision 1 — with rationale}
- {Decision 2 — with rationale}

## Task List
Execute in order. Each task is atomic and independently verifiable.

### Task 1: {ACTION} `{file path}`
**Scope**: {files touched — max 3; decompose if more} | **Outcome**: {explicit change — what is different after this task, not just where}
**Validate**: {executable command or measurable condition — no prose}
**Review**: read full diff before marking complete
**Checkpoint**: yes / no — required if 2+ files or shared state

### Task 2: {ACTION} `{file path}`
**Scope**: {files touched — max 3} | **Outcome**: {explicit change}
**Validate**: {executable command or measurable condition}
**Review**: read full diff before marking complete
**Checkpoint**: yes / no

## Testing Strategy
| Test File | Test Cases | Validates |
|-----------|------------|-----------|
| `{path}` | {cases} | {what it validates} |

## Validation Commands
1. Type check: `{command}`
2. Lint: `{command}`
3. Tests: `{command}`
4. Full validation: `{command}`

## Definition of Done
- [ ] All tasks complete
- [ ] All validation commands pass
- [ ] Full diff reviewed for every task
- [ ] No regressions in previously completed tasks (re-run full test suite, not just impacted tests)
- [ ] Each completed task still consistent with Constraints section (not just locally correct)
- [ ] Constraints met across the full feature (not just per-task)

## Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| {risk} | HIGH / MED / LOW | {specific mitigation} |
```

## Failure Protocol

Applies when **Validate** fails or **Review** catches an issue.

1. **Restore** — if a checkpoint exists for this task, restore it immediately. Do not patch forward.
2. **Fix in scope** — the fix must stay within the current task's **Scope** field. If fixing requires touching additional files, stop, redefine the task, and get the plan re-approved before continuing.
3. **Re-validate** — re-run the full **Validate** command after the fix. Do not proceed to the next task until it passes cleanly.
4. **Do not carry forward broken state** — if validation cannot be made to pass within the current task scope, escalate by splitting the task or revising the plan. Never proceed to Task N+1 with a failing Task N.

---

### Notes on using this template with Agent-Platform

**Before implementation starts:**  
Share the completed plan with Copilot and state: *"Implement Task 1 only. Do not proceed to Task 2 until I review the diff and confirm."* This enforces the review gate at the conversation level.

**Using checkpoints:**  
When **Checkpoint** is `yes`, run before the task begins:
```
@agent-platform create a checkpoint before starting Task {N}
```
If validation fails after the task, restore with:
```
@agent-platform restore the checkpoint from before Task {N}
```

**Decomposing oversized tasks:**  
If a task's **Scope** field lists more than 3 files, stop and rewrite it as multiple tasks before proceeding. A task that touches 6 files is two or three tasks, not one.

---

*Agent-Platform v0.1.0 (Beta) — MIT License — github.com/samitmeem/Agent-Platform*
