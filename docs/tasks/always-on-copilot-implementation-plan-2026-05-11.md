# Agent-Platform — Always-On Copilot Implementation Plan

**Author:** GitHub Copilot
**Date:** 2026-05-11
**Status:** Completed roadmap implementation
**Target:** Turn Agent-Platform into an always-on, read-heavy, approval-gated support layer for GitHub Copilot.

---

## Objective

Implement the roadmap in a staged way so that:

- opening any workspace automatically produces a safe, read-only project profile
- the extension stores and refreshes project state without user prompting
- Copilot can access that state through native read-only tools
- the extension suggests next actions without mutating anything
- all edit/test/command/destructive workflows remain approval-gated

This plan assumes the existing extension architecture remains intact and is extended rather than replaced.

---

## Implementation outcome

This roadmap has now been implemented through Phase 6.

### Completion snapshot

- always-on workspace profiling is implemented
- lifecycle phase detection is implemented
- extension-owned project memory initialization and refresh are implemented
- native read-only Copilot augmentation is implemented
- automatic bounded context bundles and ranked suggestions are implemented
- persistent project mode and bounded continuation are implemented
- automation profiles, performance guardrails, and explainability telemetry are implemented

### Phase status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 — Baseline stabilization | Completed | Branding/test drift and baseline validation issues were resolved during the initial stabilization work before and during phased delivery. |
| Phase 1 — Always-on workspace foundation | Completed | Workspace profiling, phase detection, persisted refresh state, and observability foundation are in place. |
| Phase 2 — Automatic project memory initialization | Completed | See `docs/tasks/phase-2-automatic-project-memory-2026-05-11.md`. |
| Phase 3 — Native Copilot augmentation | Completed | See `docs/tasks/phase-3-native-copilot-augmentation-2026-05-11.md`. |
| Phase 4 — Automatic context bundles and continuous suggestions | Completed | See `docs/tasks/phase-4-automatic-context-bundles-and-continuous-suggestions-2026-05-11.md`. |
| Phase 5 — Persistent project mode and bounded continuation | Completed | See `docs/tasks/phase-5-persistent-project-mode-and-bounded-continuation-2026-05-11.md`. |
| Phase 6 — Hardening and configuration profiles | Completed | See `docs/tasks/phase-6-automation-profiles-guardrails-and-explainability-2026-05-11.md`. |

### Final validation

Validated successfully with:

- `npm test`
- `npm run test:extension-host`
- `npm run test:mutation-e2e`

The mutation E2E suite completed via the existing backend-unavailable guard in environments where the mutation provider is not available.

### Notes

- the remaining sections below preserve the original implementation plan as a design and execution record
- future work, if desired, is now post-roadmap polish rather than unfinished roadmap delivery

---

## Current codebase anchors

These files are the main integration points for the roadmap:

- `src/extension.ts`
  - activation, registry wiring, lifecycle event hooks, status refresh
- `src/copilotTools.ts`
  - native read-only Copilot tool registration
- `src/commands/index.ts`
  - manual entry points, agent modes, project action flows
- `src/agent/runtime.ts`
  - preview/action runtime, context injection, bounded tool execution
- `src/agent/contextBuilder.ts`
  - current lightweight prompt context construction
- `src/agent/memoryBridge.ts`
  - runtime access to memory tools and recent run context
- `src/state/workspaceStore.ts`
  - persisted workspace-scoped state
- `src/views/observabilityRenderer.ts`
  - dashboard for background/agent state visibility
- `src/test/`
  - unit, integration, manifest, state, and observability coverage

---

## Design principles

1. **Always-on means read-only by default**
   - profiling, indexing, memory refresh, and suggestions happen automatically
   - edits, tests, commands, and destructive actions remain approval-gated

2. **Prefer deterministic heuristics over background LLM calls**
   - workspace profiling, phase detection, and suggestion ranking should be local and predictable first
   - model calls are reserved for planning/summarization flows already in the runtime

3. **Work without the Python backend when possible**
   - profile, phase, refresh, observability, and native Copilot context should not depend entirely on backend availability

4. **Keep state visible and inspectable**
   - if the extension becomes more automatic, the user must be able to see why it believes what it believes

5. **Extend existing architecture instead of adding a second orchestration layer**
   - reuse `WorkspaceStore`, `AgentRuntime`, `ToolRouter`, and observability surfaces

---

## Delivery phases

## Phase 0 — Baseline stabilization

### Goal
Align repo identity, docs, and tests before roadmap work lands.

### Why this phase exists
The repo still shows drift between current `Agent-Platform` branding and older `token-savior` expectations in docs/tests. That drift will create noisy failures and make roadmap validation less reliable.

### Work items

1. Align identity/docs/tests:
   - `package.json`
   - `README.md`
   - `docs/project-overview.md`
   - `src/test/packageManifest.test.ts`
2. Confirm command names and chat participant naming are consistent.
3. Run existing test suite and resolve baseline failures.

### Files likely changed

- `package.json`
- `README.md`
- `docs/project-overview.md`
- `src/test/packageManifest.test.ts`

### Acceptance criteria

- manifest tests match the current extension identity
- docs describe the current architecture accurately
- current tests pass before always-on work begins

---

## Phase 1 — Always-on workspace foundation

### Goal
Automatically build a safe, read-only understanding of the workspace on activation.

### Deliverables

#### 1. Workspace profile model
Add structured types for a profile containing:

- `repoType`
- `languages`
- `frameworks`
- `packageManagers`
- `testFrameworks`
- `hasDocker`
- `hasCi`
- `hasEnvFiles`
- `hasInstructionDocs`
- `riskAreas`
- `likelyActions`
- `generatedAt`
- `workspaceRoot`

#### 2. Workspace bootstrap service
Add `src/agent/workspaceBootstrap.ts`.

Responsibilities:

- inspect top-level files and folders
- detect likely stack using deterministic heuristics
- classify safely as:
  - docs-only
  - TypeScript/Node
  - Python
  - mixed
  - unknown
- identify evidence such as:
  - `package.json`
  - `tsconfig.json`
  - `pyproject.toml`
  - `requirements.txt`
  - `Dockerfile`
  - `.github/workflows/`
  - `.env*`
  - `README.md`
  - `docs/`

#### 3. Lifecycle phase detector
Add `src/agent/phaseDetector.ts`.

Phase outputs:

- `idea-spec`
- `scaffolding`
- `implementation`
- `testing`
- `hardening`
- `maintenance`

Each result should include:

- `phase`
- `confidence`
- `reasons[]`
- `updatedAt`

#### 4. Persist workspace state
Extend `src/state/workspaceStore.ts` to store:

- workspace profile
- phase result
- last bootstrap timestamp
- refresh status/freshness
- warnings

#### 5. Run automatically on activation
Wire into `src/extension.ts`:

- run once on activation
- rerun when workspace folders change
- do not mutate any files
- do not run project commands

#### 6. Show basic state in observability
Extend `src/views/observabilityRenderer.ts` to display:

- profile summary
- current phase
- freshness state
- warnings

### Files likely added

- `src/agent/workspaceBootstrap.ts`
- `src/agent/phaseDetector.ts`

### Files likely changed

- `src/extension.ts`
- `src/state/workspaceStore.ts`
- `src/views/observabilityRenderer.ts`
- `src/test/workspaceStore.test.ts`
- `src/test/observabilityPresentation.test.ts`

### Tests to add

- `src/test/workspaceBootstrap.test.ts`
- `src/test/phaseDetector.test.ts`

### Acceptance criteria

- opening a workspace automatically stores a profile
- docs-only repos classify correctly
- the phase detector produces a best-effort result with reasons
- no mutation or command execution occurs during profiling

---

## Phase 2 — Automatic project memory initialization

### Goal
Create and maintain concise project memory automatically instead of only when asked.

### Deliverables

#### 1. Memory snapshot initializer
Add `src/agent/projectMemoryInitializer.ts`.

Sources:

- `README.md`
- `docs/`
- repo instruction files
- config files
- top-level folder layout
- workspace profile + phase detector output

Store concise structured notes for:

- project purpose
- stack summary
- conventions
- available test commands
- dangerous files/areas
- current goals

#### 2. Incremental memory refresh
Trigger updates only when meaningful files change.

Examples:

- README or docs changed
- package/config file changed
- source/test directories created
- new CI or deployment files added

#### 3. Deduplication rules
Do not rewrite equivalent memory summaries repeatedly. Track a fingerprint or timestamped source hash per summary section.

#### 4. Extension-owned memory summary
Keep a compact extension-owned summary in workspace state so always-on context works even if backend memory tools are unavailable.

### Files likely added

- `src/agent/projectMemoryInitializer.ts`

### Files likely changed

- `src/agent/memoryBridge.ts`
- `src/state/workspaceStore.ts`
- `src/extension.ts`
- `src/test/memoryBridge.test.ts`

### Tests to add

- `src/test/projectMemoryInitializer.test.ts`

### Acceptance criteria

- a fresh workspace gets an initial memory summary automatically
- refreshes are incremental and deduplicated
- memory remains concise and phase-aware
- backend-disabled mode still has a useful project summary

---

## Phase 3 — Native Copilot augmentation

### Goal
Expose the new project state to Copilot without requiring the `@agent-platform` chat participant.

### Deliverables

#### 1. Expand native read-only tools
Update `src/copilotTools.ts` and `package.json` `contributes.languageModelTools`.

Add read-only tools such as:

- `agent-platform_get_workspace_profile`
- `agent-platform_detect_phase`
- `agent-platform_get_next_actions`
- `agent-platform_get_recent_run_summary`
- `agent-platform_get_project_memory_summary`
- `agent-platform_get_context_bundle`
- `agent-platform_list_test_commands`
- `agent-platform_discover_project_actions`

#### 2. Source native tool data from extension state first
These tools should preferentially read from extension-managed workspace state, then optionally enrich from backend/tool data when available.

#### 3. Preserve safety boundary
Do not expose edit/test/destructive tools through implicit native Copilot flows.

### Files likely changed

- `src/copilotTools.ts`
- `package.json`
- `src/state/workspaceStore.ts`
- possibly `src/tools/interface.ts` for shared state/result types

### Tests to add/update

- manifest tests for new tool contributions
- tool registration tests for native read-only tool behavior

### Acceptance criteria

- Copilot can retrieve profile/phase/context without `@agent-platform`
- native tools remain read-only
- backend unavailability does not break the basic profile/phase tools

---

## Phase 4 — Automatic context bundles and continuous suggestions

### Goal
Keep Copilot supplied with relevant, bounded project context and next-step guidance.

### Deliverables

#### 1. Expand context bundles
Extend `src/agent/contextBuilder.ts` to include bounded summaries of:

- active file
- selected text
- workspace profile
- lifecycle phase
- recent project memory summary
- recent run summary
- top next actions
- current warnings

Use the existing context budget logic in `src/agent/contextBudget.ts`.

#### 2. Suggestion engine
Add `src/agent/suggestionEngine.ts`.

Inputs:

- phase
- profile
- recent completed work
- failed validations/tests
- missing tests
- missing env/config scaffolds
- discovered actions

Outputs:

- ranked next-step list
- reasons for each suggestion
- priority and source metadata

#### 3. Background refresh coordinator
Add `src/agent/refreshCoordinator.ts`.

Responsibilities:

- debounce file changes
- refresh profile
- refresh phase
- refresh memory summary
- refresh suggestions
- update freshness status

#### 4. Make refresh observable
Track:

- last refresh time
- last successful refresh time
- stale state
- last refresh error

### Files likely added

- `src/agent/suggestionEngine.ts`
- `src/agent/refreshCoordinator.ts`

### Files likely changed

- `src/agent/contextBuilder.ts`
- `src/agent/runtime.ts`
- `src/state/workspaceStore.ts`
- `src/views/observabilityRenderer.ts`
- `src/extension.ts`

### Tests to add

- `src/test/suggestionEngine.test.ts`
- `src/test/refreshCoordinator.test.ts`
- updates to `src/test/contextBuilder.test.ts`
- updates to observability tests

### Acceptance criteria

- meaningful file changes trigger debounced refresh
- suggestions update automatically
- suggestions are grounded, concise, and non-mutating
- context bundles stay within defined budgets

---

## Phase 5 — Persistent project mode and bounded continuation

### Goal
Support long-lived project execution with continuity across sessions while preserving approval boundaries.

### Deliverables

#### 1. Project mode state
Extend workspace state with:

- `goal`
- `milestones[]`
- `completedMilestoneIds[]`
- `lastApprovedWorkflow`
- `updatedAt`

#### 2. Bounded continuation support
Extend the action runtime so a single approved intent can continue through a bounded workflow such as:

- inspect target
- edit file
- run impacted tests
- summarize outcome
- propose next step

This should build on the existing action runtime and `ToolRouter`, not create a parallel executor.

#### 3. Stronger project action discovery
Improve action discovery from:

- `package.json` scripts
- `Makefile`
- `pyproject.toml`
- `requirements.txt`
- `docker-compose.yml`
- README instructions

#### 4. Impacted-test guidance
After mutations or action runs, suggest impacted tests and validation steps automatically, but keep execution approval-gated.

### Files likely added

- `src/agent/projectMode.ts` (or equivalent state/controller module)

### Files likely changed

- `src/agent/runtime.ts`
- `src/commands/index.ts`
- `src/state/workspaceStore.ts`
- `src/views/observabilityRenderer.ts`

### Tests to add/update

- action runtime tests
- project mode persistence tests
- workflow continuation tests
- action discovery tests

### Acceptance criteria

- project progress survives reload/restart
- a single approved instruction can drive a bounded multi-step workflow
- approval policies still gate edits/tests/commands/destructive operations correctly

---

## Phase 6 — Hardening and configuration profiles

### Goal
Make always-on behavior tunable, safe, observable, and lightweight.

### Deliverables

#### 1. Configuration profiles
Add settings for:

- `conservative`
- `balanced`
- `aggressive-but-safe`

Suggested behavior:

- **Conservative**
  - automatic bootstrap only
  - minimal suggestions
  - approval for everything else
- **Balanced**
  - bootstrap + memory refresh + suggestions
  - mutation still approval-gated
- **Aggressive but safe**
  - bootstrap + memory refresh + action discovery refresh + test suggestions
  - still no silent edits or destructive actions

#### 2. Performance guardrails
Add limits for:

- refresh debounce interval
- profile scan breadth/depth
- suggestion list size
- context bundle size
- stale-state thresholds

#### 3. Recovery and explainability
Improve:

- cancellation/recovery when refresh fails
- user-visible reasons for suggestions/phase changes
- telemetry around false positives/noisy suggestions

### Files likely changed

- `src/config.ts`
- `package.json`
- `src/extension.ts`
- `src/views/observabilityRenderer.ts`
- telemetry and state files as needed

### Acceptance criteria

- user can understand and choose automation level
- the extension remains responsive on larger repos
- automatic behavior remains inspectable and non-destructive

---

## Proposed state model additions

Extend `WorkspaceStore` with persisted records for the following.

### Workspace profile

- `workspaceRoot`
- `repoType`
- `languages[]`
- `frameworks[]`
- `packageManagers[]`
- `testFrameworks[]`
- `hasDocker`
- `hasCi`
- `hasEnvFiles`
- `hasInstructionDocs`
- `riskAreas[]`
- `likelyActions[]`
- `generatedAt`

### Lifecycle state

- `phase`
- `confidence`
- `reasons[]`
- `updatedAt`

### Refresh state

- `status`
- `lastRefreshAt`
- `lastSuccessfulRefreshAt`
- `stale`
- `lastError`

### Suggestions

- `items[]`
  - `id`
  - `title`
  - `reason`
  - `priority`
  - `source`
  - `createdAt`

### Project mode state

- `goal`
- `milestones[]`
- `completedMilestoneIds[]`
- `lastApprovedWorkflow`
- `updatedAt`

---

## PR breakdown

Use small, testable pull requests.

### PR 1
Baseline cleanup + workspace profile + phase detection + observability display

### PR 2
Automatic project memory initialization + persisted extension-owned summary

### PR 3
Native Copilot tool expansion for workspace profile, phase, memory summary, and context bundle access

### PR 4
Refresh coordinator + suggestion engine + bounded context bundle updates

### PR 5
Persistent project mode + bounded continuation + stronger action discovery

### PR 6
Configuration profiles + performance guardrails + telemetry/explainability hardening

---

## Verification plan

### Automated

Run after each PR:

- `npm test`
- `npm run test:extension-host`

Run targeted tests for newly added modules whenever possible.

### Manual scenarios

1. **Docs-only repo**
   - profile = docs-only or unknown-safe
   - phase = idea/spec or scaffolding
   - no mutation occurs

2. **TypeScript repo**
   - profile identifies Node/TypeScript and test scripts
   - phase reflects current maturity

3. **Workspace change / file save**
   - refresh runs with debounce
   - freshness updates in observability
   - no noisy repeated refresh loops

4. **Native Copilot usage**
   - profile/phase/context available without `@agent-platform`
   - tools remain read-only

5. **Action mode**
   - edits/tests/commands still request approval according to policy
   - workflow continuation respects approval boundaries

---

## Risks to avoid

- coupling always-on behavior too tightly to the Python backend
- using LLM calls for basic repo classification or refresh logic
- stuffing large raw docs into every prompt
- exposing mutating tools implicitly to native Copilot flows
- auto-running commands in unknown or untrusted repos
- duplicating project memory on every refresh
- building a second orchestration runtime instead of extending the current one

---

## Recommended first implementation slice

Start with the smallest useful slice:

1. add `workspaceBootstrap.ts`
2. add `phaseDetector.ts`
3. extend `workspaceStore.ts` for profile + phase + refresh metadata
4. run bootstrap automatically from `extension.ts`
5. show profile/phase/freshness in observability
6. add tests for profile detection and persistence

This delivers the first real always-on capability and unlocks the rest of the roadmap cleanly.

---

## Definition of success

Agent-Platform succeeds as an always-on Copilot support layer when:

- opening a new repo automatically yields a useful workspace profile
- Copilot gains project context without repeated explicit invocation
- the system tracks lifecycle phase accurately enough to guide work
- project memory stays fresh automatically
- next-step suggestions are usually relevant
- mutation still requires approval
- the user no longer needs to restate core project context in every new chat
