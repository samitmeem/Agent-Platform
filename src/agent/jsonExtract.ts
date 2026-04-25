/**
 * FIX-3: Strict JSON extraction with diagnostic logging.
 *
 * Old code: scanned for first `{` and last `}` — matched wrong objects when
 * the model added explanatory text containing curly braces.
 *
 * New code: tries fenced JSON block first (```json ... ```), then bare JSON
 * only if the whole trimmed string starts and ends with braces.
 * Falls back to the old brace-scan only as a last resort, emitting a warning.
 */

export function extractFirstJsonObject(
  text: string,
  onFallback?: (reason: string) => void,
): string | undefined {
  const trimmed = text.trim();

  // 1. Prefer ```json ... ``` fenced block — most reliable
  const fencedJson = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson?.[1]?.trim()) {
    return fencedJson[1].trim();
  }

  // 2. Plain ``` ... ``` fence
  const fenced = trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return fenced[1].trim();
  }

  // 3. Entire response is a bare JSON object
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  // 4. Last resort: brace scan — emit a diagnostic warning
  const firstBrace = trimmed.indexOf("{");
  const lastBrace  = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1).trim();
    onFallback?.(`Model response did not contain a fenced JSON block; ` +
      `fell back to brace scan. Response prefix: "${trimmed.slice(0, 120)}"`);
    return candidate;
  }

  return undefined;
}
