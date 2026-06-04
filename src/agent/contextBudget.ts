/**
 * FIX-2: Context window budget enforcement.
 *
 * The old code passed selectedText and tool results untruncated into prompts.
 * On large files this silently blew the model context window.
 *
 * Limits applied:
 *  - selectedText:        max 2 000 chars  (~500 tokens)
 *  - each tool result:    max 3 000 chars
 *  - total context block: max 6 000 chars
 */

export const SELECTED_TEXT_MAX_CHARS = 2_000;
export const TOOL_RESULT_MAX_CHARS   = 3_000;
export const CONTEXT_BLOCK_MAX_CHARS = 6_000;

export function truncate(text: string, maxChars: number, label = "content"): string {
  if (text.length <= maxChars) { return text; }
  const suffix = `\n[${label} truncated — ${text.length - maxChars} chars omitted]`;
  return text.slice(0, maxChars - suffix.length) + suffix;
}

export function budgetSelectedText(text: string | undefined): string | undefined {
  if (!text?.trim()) { return undefined; }
  return truncate(text.trim(), SELECTED_TEXT_MAX_CHARS, "selected text");
}

export function budgetToolResult(text: string, maxChars = TOOL_RESULT_MAX_CHARS): string {
  return truncate(text, maxChars, "tool result");
}

export function budgetContextBlock(text: string, maxChars = CONTEXT_BLOCK_MAX_CHARS): string {
  return truncate(text, maxChars, "context");
}
