# Agent-Platform — Phase 6 Automation Profiles, Guardrails, and Explainability

**Author:** GitHub Copilot
**Date:** 2026-05-11
**Status:** Completed

---

## What was done

Implemented Phase 6 of the always-on Copilot roadmap by adding configurable automation profiles, performance guardrails, stale-state hardening, and richer observability/telemetry for background automation behavior.

Completed work:

- added automation-profile loading in `src/config.ts` with three modes:
  - `conservative`
  - `balanced`
  - `aggressive-but-safe`
- added manifest-exposed Phase 6 settings for:
  - refresh debounce
  - profile scan limits
  - project-memory source scan limits
  - action discovery cap
  - suggestion cap
  - runtime context bundle cap
  - stale-state threshold
  - noisy-suggestion threshold
- wired automation settings into the background refresh pipeline so profile selection now affects real behavior instead of inert configuration
- updated `WorkspaceRefreshCoordinator` to:
  - use profile-driven debounce values
  - enforce stale-state thresholds
  - skip automatic project-memory refresh in conservative mode
  - skip automatic ranked suggestions in conservative mode
  - preserve explicit workflow continuity while limiting background automation
  - emit refresh telemetry events for observability
- updated workspace bootstrap and project-memory initialization to respect scan budgets and emit warnings when scans are intentionally truncated
- updated runtime context construction to honor a configurable context-bundle character budget
- applied the existing `toolTimeoutMs` setting to the backend gateway at activation and on configuration changes
- refined configuration-change handling so backend/provider restarts only happen for relevant backend/model settings, not every `agentPlatform.*` setting change
- expanded telemetry state to track:
  - automation profile
  - workspace refresh count
  - refresh failures
  - stale refreshes
  - phase changes
  - suggestion refreshes
  - noisy suggestion churn
  - last refresh reason
  - last suggestion churn summary
- updated observability rendering to show:
  - active automation profile
  - guardrail values
  - refresh/noise telemetry
  - existing lifecycle/project state alongside the new Phase 6 signals
- extended tests to cover:
  - automation manifest settings
  - custom context budget enforcement
  - conservative automation refresh behavior
  - refresh telemetry and suggestion churn
  - observability rendering of Phase 6 data
  - extension-host visibility of automation profile details

---

## Files modified

### New files

- `docs/tasks/phase-6-automation-profiles-guardrails-and-explainability-2026-05-11.md`

### Updated files

- `package.json`
- `src/config.ts`
- `src/agent/contextBudget.ts`
- `src/agent/contextBuilder.ts`
- `src/agent/projectMemoryInitializer.ts`
- `src/agent/refreshCoordinator.ts`
- `src/agent/runtime.ts`
- `src/agent/workspaceBootstrap.ts`
- `src/chat/participant.ts`
- `src/commands/index.ts`
- `src/extension.ts`
- `src/state/telemetryState.ts`
- `src/views/observabilityPanel.ts`
- `src/views/observabilityRenderer.ts`
- `src/test/contextBuilder.test.ts`
- `src/test/extensionHost/smoke.ts`
- `src/test/observabilityPanel.test.ts`
- `src/test/packageManifest.test.ts`
- `src/test/refreshCoordinator.test.ts`
- `src/test/telemetryState.test.ts`

---

## Verification

Ran successfully:

- `npm test`
- `npm run test:extension-host`
- `npm run test:mutation-e2e`

Mutation E2E completed successfully with the existing environment guard because the backend mutation provider was unavailable in this environment.

---

## Remaining work

Phase 6 is complete relative to the roadmap implementation plan.

Possible follow-up improvements beyond the roadmap:

- expose automation-profile badges or summaries in additional UI entry points beyond the observability panel
- add explicit user controls for temporarily pausing background refresh without changing the saved automation profile
- correlate noisy suggestion churn with specific workspace files or refresh reasons for deeper diagnostics

---

## Known limitations

- automation profiles currently control deterministic extension-owned refresh behavior; they do not override approval policies for edit, test, command, or destructive tools
- conservative mode limits automatic project memory and suggestions, but explicit approved workflows can still update stored continuity state through command flows
- workspace scan limits are breadth-first heuristics, not semantic indexes; very large repositories may still require manual inspection for edge-case files outside the configured scan window
- context bundle budgets are character-based guardrails rather than exact token accounting
