# Agent-Platform — Release 0.2.0

**Author:** GitHub Copilot
**Date:** 2026-06-04
**Status:** Completed

---

## What was done

Prepared the standalone `0.2.0` release for GitHub-triggered publishing.

Completed work:

- synchronized the extension manifest version to `0.2.0`
- synchronized the lockfile root package identity and version to `agent-platform@0.2.0`
- updated shipped usage documentation to reference `0.2.0`
- refreshed the project overview doc so it points at the current repository, publisher, and chat participant identity
- prepared the repository for tag-triggered GitHub Marketplace/Open VSX publishing via `ext-v0.2.0`

---

## Files modified

- `package.json`
- `package-lock.json`
- `docs/AGENT_PLATFORM_USAGE.md`
- `docs/project-overview.md`
- `docs/tasks/release-0.2.0-2026-06-04.md`

---

## Verification

Ran successfully:

- `npm test`
- `npm run publish:dry-run`

Not required by the GitHub release workflow and previously blocked only by a local machine updater lock:

- `npm run test:extension-host`

---

## Remaining work

- GitHub Actions must complete the tag-triggered publish workflow using repository secrets (`VSCE_PAT`, `OVSX_PAT`)

---

## Known limitations

- publish success still depends on GitHub repository secrets being configured correctly
- extension-host tests were not used as a release gate for this tag because the repository workflow does not currently enforce them