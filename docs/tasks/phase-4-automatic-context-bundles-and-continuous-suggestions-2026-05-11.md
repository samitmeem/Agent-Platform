# Agent-Platform — Phase 4 Automatic Context Bundles and Continuous Suggestions

**Author:** GitHub Copilot
**Date:** 2026-05-11
**Status:** Completed

---

## What was done

Implemented Phase 4 of the always-on Copilot roadmap by adding automatic workspace context bundles, continuous background refresh, and persisted ranked next-step suggestions.

Completed work:

- added persisted workspace suggestion state to the workspace store
- implemented a pure `suggestionEngine` that ranks refresh, validation, test, config, risk, continuity, and action-based suggestions
- implemented a debounced `WorkspaceRefreshCoordinator` that:
  - serializes in-flight refreshes
  - queues one follow-up refresh when changes arrive mid-refresh
  - refreshes workspace profile, phase, project memory, suggestions, and refresh state together
- replaced the old inline workspace bootstrap flow in extension activation with the refresh coordinator
- extended runtime context building so preview/action runs receive a bounded workspace context bundle containing:
  - workspace profile
  - lifecycle phase
  - project memory summary
  - top next actions
  - recent run summary
  - current warnings / refresh issues
- updated native Copilot next-action behavior so stored suggestions are preferred when available
- updated observability rendering to display top suggestions and suggestion counts
- threaded the new workspace state resolvers through command and chat runtime entry points
- added unit coverage for:
  - suggestion ranking behavior
  - refresh coordinator debouncing and error handling
  - context bundle budgeting
  - suggestion persistence
- extended extension-host smoke coverage to assert that automatic suggestions exist after activation

---

## Files modified

### New files

- `src/agent/suggestionEngine.ts`
- `src/agent/refreshCoordinator.ts`
- `src/test/suggestionEngine.test.ts`
- `src/test/refreshCoordinator.test.ts`
- `docs/tasks/phase-4-automatic-context-bundles-and-continuous-suggestions-2026-05-11.md`

### Updated files

- `src/agent/contextBuilder.ts`
- `src/agent/copilotToolState.ts`
- `src/agent/runtime.ts`
- `src/chat/participant.ts`
- `src/commands/index.ts`
- `src/copilotTools.ts`
- `src/extension.ts`
- `src/state/workspaceAnalysis.ts`
- `src/state/workspaceStore.ts`
- `src/views/observabilityPanel.ts`
- `src/views/observabilityRenderer.ts`
- `src/test/contextBuilder.test.ts`
- `src/test/copilotTools.test.ts`
- `src/test/extensionHost/smoke.ts`
- `src/test/observabilityPanel.test.ts`
- `src/test/workspaceStore.test.ts`

---

## Verification

Ran successfully:

- `npm test`
- `npm run test:extension-host`
- `npm run test:mutation-e2e`

Mutation E2E completed successfully with the existing environment guard because the backend mutation provider was unavailable in this environment.

---

## Remaining work

Recommended next roadmap phase:

- Phase 5 — use the new always-on state to drive stronger workflow continuity and smarter approval-aware execution guidance
- optionally enrich suggestion generation with more nuanced risk scoring once there is evidence that the current deterministic heuristics are insufficient

---

## Known limitations

- continuous suggestions are deterministic and extension-owned; they do not call an LLM for ranking or explanation
- the refresh coordinator currently queues a single follow-up refresh reason rather than maintaining an unbounded event backlog
- stored suggestions intentionally favor safety and continuity over aggressive action recommendations
- observability surfaces suggestion reasons and counts, but there is not yet a dedicated command to manually recompute or inspect suggestion scoring details in isolation
