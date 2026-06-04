# Agent-Platform — Phase 3 Native Copilot Augmentation

**Author:** GitHub Copilot
**Date:** 2026-05-11
**Status:** Completed

---

## What was done

Implemented Phase 3 of the always-on Copilot roadmap by expanding the extension's native read-only Copilot tool surface.

Completed work:

- expanded native Copilot tools beyond backend symbol lookup tools
- added state-backed native tools for:
  - workspace profile
  - lifecycle phase
  - next actions
  - recent run summary
  - project memory summary
  - context bundle
  - test command listing
  - project action discovery
- changed native tool registration so it no longer depends on backend enablement
- kept all native Copilot tools read-only
- preserved the safety boundary by not exposing edit, test execution, command execution, or destructive tools through native Copilot registration
- split pure state-derivation logic into a Node-safe helper module so it can be unit tested without the VS Code runtime
- updated manifest contributions and tests for the expanded native tool surface

---

## Files modified

### New files

- `src/agent/copilotToolState.ts`
- `src/test/copilotTools.test.ts`
- `docs/tasks/phase-3-native-copilot-augmentation-2026-05-11.md`

### Updated files

- `src/copilotTools.ts`
- `src/extension.ts`
- `package.json`
- `src/test/packageManifest.test.ts`

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

- Phase 4 — automatic context bundles and continuous suggestions
  - add a dedicated suggestion engine
  - add a debounced refresh coordinator
  - persist suggestion state
  - surface refresh reasons and stale/error state more explicitly

---

## Known limitations

- native Copilot tools expose read-only state and discovery, but they do not yet publish a dedicated suggestion engine output
- project action discovery still relies mostly on workspace heuristics unless a backend read provider is available
- backend-dependent native tools such as symbol lookup still return graceful read-only fallback messages when no provider is registered instead of an enriched offline implementation
