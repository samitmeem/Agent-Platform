# Changelog

## [0.2.0] — Standalone Release

Initial standalone release extracted from the token-savior monorepo.

### Fixes applied vs. monorepo v0.1.0

- **FIX-1** System message now uses `vscode.LanguageModelChatMessage.System`
- **FIX-2** Context window budget enforced — selectedText and tool results truncated before prompts
- **FIX-3** JSON extraction uses fenced block first; logs warning on brace-scan fallback
- **FIX-4** Tool call timeout via `Promise.race` (default 30 s, configurable)
- **FIX-5** Agent loop wraps each tool step in try/catch; surfaces clean failure messages
- **FIX-6** Dynamic tool discovery — `capabilities.list` queried at session start
- **FIX-7** Backend reconnect with exponential backoff (3 retries, 400 ms base)
- **FIX-8** Cancellation propagated via AbortController polled from VS Code CancellationToken
- **FIX-9** Error signalling contract documented: uses `ok/error` fields, not string prefix
- **FIX-10** `StoredPreviewRun` stored as compact summary in Memento, not full result tree

## [0.1.0] — Monorepo baseline

Initial implementation inside token-savior monorepo.
