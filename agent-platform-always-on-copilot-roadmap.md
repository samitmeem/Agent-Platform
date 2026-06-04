# Agent-Platform Roadmap: Always-On Copilot Support Layer

## Objective

Turn **Agent-Platform** from a command/chat-driven extension into an **always-on project support layer for GitHub Copilot** that helps across the full lifecycle of any new project:

- project bootstrap
- architecture understanding
- implementation planning
- safe code mutation
- testing and verification
- progress continuity across sessions

The target is **not** fully silent autonomy.
The target is:

> **continuous, low-friction, approval-aware support for Copilot from project start to project completion**

---

## What “always-on” should mean

Agent-Platform should:

1. activate automatically in every workspace
2. infer project type and current phase without being explicitly called each time
3. maintain project memory continuously
4. keep Copilot supplied with relevant workspace context and next-step guidance
5. expose useful tools to Copilot natively, not only through `@agent-platform`
6. require approval only for mutating, test-running, or destructive operations

It should **not**:

- silently edit files without user consent
- run destructive commands automatically
- invent workflows the repo does not support
- replace Copilot’s reasoning layer entirely

---

## Current state

Based on the current extension design, Agent-Platform already has these foundations:

- dynamic tool-provider registry
- Copilot model provider integration
- local model provider integration
- chat participant
- preview/action runtime separation
- approval policies for edit/test/command/destructive actions
- run history and observability
- optional memory workflows
- limited native Copilot tool registration

### Current limitation

Today it behaves mainly as:

- a chat participant
- a command palette tool
- a bounded action agent
- a partial read-only tool bridge for Copilot

It does **not yet** behave as an always-on orchestration layer that continuously supports Copilot in every project.

---

## Gap between current behavior and target behavior

### Current
- User invokes commands manually
- User invokes `@agent-platform` chat manually
- Native Copilot receives only a small subset of tools
- Project understanding depends heavily on explicit interaction
- Memory is optional and mostly reactive
- No automatic lifecycle awareness

### Target
- Workspace is profiled automatically on open
- Project memory is built and refreshed continuously
- Copilot can access richer project tools natively
- Agent-Platform tracks implementation phase and recommends next steps
- The system proactively prepares context, but asks approval before mutation
- The user does not need to “summon” the system repeatedly for every phase

---

## Required features

## 1. Automatic workspace bootstrap

### Goal
When a new workspace opens, Agent-Platform should automatically build a safe, read-only understanding of the project.

### Required capabilities
- detect workspace root and project type
- inspect top-level files and folders
- identify likely stack:
  - Python
  - TypeScript/Node
  - Flutter/Dart
  - FastAPI
  - React
  - docs-only repo
- detect presence of:
  - package managers
  - test frameworks
  - Docker files
  - CI configs
  - environment files
  - instructions/spec docs
- generate a workspace profile

### Output
A stored profile such as:
- repo type
- languages
- frameworks
- available test commands
- risk areas
- likely next actions

### Acceptance criteria
- On workspace open, a profile is generated automatically within a bounded timeout.
- If no stack is detected, the workspace is classified safely as docs-only or unknown.
- No file mutation occurs during profiling.

---

## 2. Automatic project memory initialization

### Goal
Agent-Platform should create and maintain durable project memory automatically, not only when asked.

### Required capabilities
- initialize project memory from:
  - README
  - architecture docs
  - repo instructions
  - config files
  - folder layout
- store:
  - project purpose
  - stack summary
  - conventions
  - test commands
  - dangerous files
  - active goals
- refresh memory when major files change
- deduplicate memory updates

### Acceptance criteria
- A fresh project gets an initial memory snapshot automatically.
- Subsequent updates are incremental, not full rewrites.
- Memory entries are concise, structured, and phase-aware.

---

## 3. Lifecycle/phase detection

### Goal
The extension should know roughly where the project is in its lifecycle so it can support Copilot appropriately.

### Required phases
- idea / spec phase
- scaffolding phase
- implementation phase
- testing phase
- hardening phase
- maintenance phase

### Detection signals
- presence of only markdown/spec files
- source directories created
- tests introduced
- CI introduced
- deployment files introduced
- recent run history and commands

### Why this matters
Copilot support should differ by phase:
- in spec phase → summarize, structure, identify missing decisions
- in scaffolding phase → generate project skeleton safely
- in implementation phase → trace symbols, impacts, tests
- in testing phase → prioritize validation loops

### Acceptance criteria
- System assigns a best-effort lifecycle phase.
- Phase changes when repo evidence changes.
- Wrong phase never causes unsafe action execution.

---

## 4. Continuous “next best action” engine

### Goal
Agent-Platform should continuously maintain a ranked view of what should happen next, so Copilot gets support without constant re-prompting.

### Required capabilities
- compute next suggested actions from:
  - project phase
  - recent completed work
  - open gaps in architecture
  - missing tests
  - errors or failed validations
- store a short next-step queue
- update queue after:
  - file changes
  - test results
  - command execution
  - accepted edits

### Examples
- “Create backend folder scaffold”
- “Define Pydantic settings before service wiring”
- “Add auth tests before implementing refresh rotation”
- “Run impacted tests for changed auth module”

### Acceptance criteria
- Suggestions are grounded in the repo state.
- Suggestions are concise and actionable.
- Suggestions never trigger edits by themselves.

---

## 5. Deep native Copilot tool exposure

### Goal
Copilot should benefit from Agent-Platform without requiring the `@agent-platform` participant for most support flows.

### Current native exposure
Currently only limited read-only tools are exposed.

### Required expansion
Expose more safe tools to Copilot natively, including:
- project summary
- workspace profile
- memory search
- recent run summary
- discover project actions
- list test commands
- list impacted tests
- find symbol
- get dependencies
- get change impact
- get full context
- detect phase
- get next best actions

### Mutating tools
Mutating tools should remain approval-gated and only available when explicitly entering action mode.

### Acceptance criteria
- Copilot can access read-only context tools directly.
- Copilot can retrieve project memory and lifecycle info without using the chat participant.
- No destructive tools are exposed implicitly.

---

## 6. Automatic context injection for Copilot

### Goal
Before Copilot plans or answers, Agent-Platform should prepare the most relevant project context automatically.

### Required capabilities
Build compact context bundles from:
- active file
- selected text
- project profile
- current phase
- recent memory notes
- recent run history
- likely relevant symbols/files

### Context bundle types
- bootstrap context
- symbol context
- architecture context
- test context
- mutation safety context

### Rules
- respect token budgets
- prioritize recent and relevant signals
- degrade gracefully when repo is large

### Acceptance criteria
- Context bundles are automatically available to planning flows.
- Context remains bounded and does not explode with repo size.
- Context is phase-sensitive and task-sensitive.

---

## 7. Background indexing and refresh loop

### Goal
The platform should keep its understanding fresh without manual reindexing every time.

### Required capabilities
- background read-only indexing on workspace open
- debounced refresh after meaningful file changes
- symbol/file metadata refresh
- project action refresh
- test discovery refresh

### Constraints
- do not hammer the machine continuously
- debounce aggressively
- allow manual reindex override
- provide visible status for indexing freshness

### Acceptance criteria
- Index stays reasonably fresh during active development.
- Reindexing is bounded and observable.
- Failures degrade gracefully without breaking the extension.

---

## 8. Safe proactive assistance model

### Goal
Agent-Platform should become proactive without becoming reckless.

### Proactive behaviors allowed
- update workspace profile automatically
- refresh memory automatically
- suggest next steps automatically
- suggest impacted tests automatically
- suggest missing files/configs automatically
- warn when environment variables or test scaffolds are missing

### Behaviors not allowed automatically
- edit files
- run destructive commands
- restore checkpoints
- execute build/test commands in untrusted situations
- rewrite code without user approval

### Acceptance criteria
- Proactivity is limited to read-only analysis and suggestions.
- All mutations remain approval-gated.
- User can configure level of proactivity.

---

## 9. Approval-aware action continuation

### Goal
The user should not need to re-explain intent for every step in a multi-step workflow.

### Required capabilities
When user approves an action workflow, Agent-Platform should be able to continue safely through a bounded plan such as:
- inspect target
- edit file
- run impacted tests
- summarize result
- propose next step

### Important constraint
Continuation must still obey approval policy boundaries.

### Acceptance criteria
- One user intent can drive a bounded multi-step workflow.
- Each mutating/test/destructive class respects configured policy.
- The run can resume contextually after interruptions.

---

## 10. Stronger project action discovery

### Goal
Every project should automatically expose a useful action surface as early as possible.

### Required capabilities
Discover actions from common evidence:
- `package.json` scripts
- `Makefile`
- `pyproject.toml`
- `requirements.txt`
- `docker-compose.yml`
- Flutter commands
- test configs
- README instructions

### Example actions
- install dependencies
- run tests
- run linter
- start dev server
- run migrations
- build mobile app

### Acceptance criteria
- Action discovery works without custom repo wiring when common files exist.
- Unknown repos degrade gracefully.
- Discovered actions include trust/safety metadata.

---

## 11. Start-to-finish implementation mode

### Goal
Provide a dedicated project mode where Agent-Platform acts as a persistent implementation companion for Copilot.

### Behavior
This mode should:
- track project goal
- track current phase
- maintain milestone checklist
- remember completed steps
- suggest next milestone automatically
- keep Copilot aligned with original goals

### Example lifecycle
1. user opens new repo
2. workspace profile is created
3. phase detected as spec/scaffold
4. Copilot receives project summary and next-step suggestions
5. user approves scaffold work
6. Agent-Platform tracks created files and updates memory
7. system suggests next implementation milestone
8. tests are discovered and proposed
9. final hardening suggestions appear before release

### Acceptance criteria
- Project mode can stay useful across many sessions.
- Progress survives reload/restart.
- The system reduces repeated prompting.

---

## 12. Better docs-first repo support

### Goal
Agent-Platform must support the early phase where a repo is mostly markdown and architecture docs.

### Why this matters
Many projects begin exactly like `Eng_project`:
- specs first
- architecture first
- no symbols/tests yet

### Required capabilities
- extract structured decisions from docs
- identify unresolved architecture questions
- recommend scaffold order
- convert specs into implementation milestones
- classify docs as canonical vs archive vs outdated

### Acceptance criteria
- Docs-only repos are first-class citizens.
- Extension remains useful before code exists.
- It can transition naturally from doc phase to code phase.

---

## 13. Better observability for continuous support

### Goal
If the extension becomes more automatic, it must also become more transparent.

### Required capabilities
Show:
- current workspace profile
- detected project phase
- indexing freshness
- active memory summary
- top suggested next actions
- last approved action flow
- pending warnings

### Acceptance criteria
- User can always see why the extension is suggesting something.
- Hidden background behavior is minimized.
- Automatic support remains inspectable and debuggable.

---

## 14. Configuration profiles

### Goal
Different users want different levels of automation.

### Recommended profiles
#### Conservative
- read-only bootstrap only
- no proactive suggestions beyond summary
- approval required for everything else

#### Balanced
- automatic profiling
- automatic memory refresh
- next-step suggestions enabled
- mutating actions still approval-gated

#### Aggressive but safe
- automatic profiling
- automatic memory refresh
- automatic test suggestions
- automatic action discovery refresh
- approval only for edit/test/destructive actions

### Acceptance criteria
- User can choose profile globally or per workspace.
- Profiles are understandable and safe.

---

## 15. Minimal architecture changes required

### A. Add a workspace bootstrap service
Responsibilities:
- detect stack
- build workspace profile
- trigger initial memory load

### B. Add a phase detector
Responsibilities:
- classify repo lifecycle phase
- re-evaluate after meaningful changes

### C. Add a suggestion engine
Responsibilities:
- compute next best actions
- rank and store suggestions

### D. Add a background refresh coordinator
Responsibilities:
- debounce file changes
- refresh indexes, memory, phase, and suggestions

### E. Expand Copilot-native tool registration
Responsibilities:
- expose more safe read-only tools to Copilot
- keep mutating tools out of implicit flows

### F. Add persistent project-mode state
Responsibilities:
- track milestones
- track active goals
- track latest known repo state

---

## 16. Recommended implementation phases

## Phase 1 — Foundation
Build:
- workspace bootstrap
- initial memory load
- phase detection
- workspace profile view

### Success criteria
- Open any repo and get a correct high-level profile.
- Docs-only repos are handled gracefully.

---

## Phase 2 — Native Copilot augmentation
Build:
- expanded safe tool exposure
- automatic context bundles
- memory + phase tools available to Copilot

### Success criteria
- Copilot gets richer repo awareness without needing `@agent-platform` each time.

---

## Phase 3 — Continuous guidance
Build:
- next best action engine
- background refresh coordinator
- proactive suggestions panel

### Success criteria
- Agent-Platform continuously suggests useful next steps without mutating anything.

---

## Phase 4 — Bounded implementation workflows
Build:
- persistent project mode
- multi-step continuation with approvals
- stronger project action discovery
- impacted test guidance

### Success criteria
- One user instruction can drive a safe, bounded implementation workflow with fewer repeated prompts.

---

## Phase 5 — Hardening
Build:
- performance guardrails
- profile tuning
- better cancellation/recovery
- explainability improvements
- telemetry for usefulness/false positives

### Success criteria
- Always-on support feels helpful, not noisy or heavy.

---

## 17. Non-negotiable safety rules

1. No silent file edits
2. No silent destructive actions
3. No automatic command execution in unknown/untrusted repos
4. No hardcoded assumptions about stack or tools
5. No token-heavy context stuffing without budgets
6. No hidden background mutation disguised as “memory maintenance”
7. All proactive behavior must remain inspectable

---

## 18. Definition of success

Agent-Platform succeeds as an always-on Copilot support layer when:

- opening a new repo automatically yields a useful workspace profile
- Copilot gains meaningful project context without repeated explicit invocation
- the system tracks lifecycle phase accurately enough to guide work
- project memory stays fresh automatically
- next-step suggestions are usually relevant
- mutation still requires approval
- the user feels less need to restate project context in every new chat

---

## 19. Final recommendation

The correct product direction is:

> **Always-on, read-heavy, context-rich, approval-gated support for Copilot**

Not:

> **silent autonomous coding without consent**

That distinction preserves safety while still delivering the real value you want: a system that supports project work from beginning to end without needing to be manually summoned every time.
