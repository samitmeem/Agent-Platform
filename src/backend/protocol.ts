export interface ServiceHealth {
  version: string;
  profile: string;
  capability_count: number;
  project_count: number;
  active_project?: string | null;
}

/**
 * FIX-9: Error signalling contract.
 * The backend MUST set ok=false and populate `error` for all failures.
 * Error detection MUST NOT rely on content[].startsWith("Error:").
 */
export interface ServiceToolResult {
  name: string;
  ok: boolean;
  content: string[];
  error?: string | null;
  active_project?: string | null;
}

export interface SymbolLocation {
  file: string;
  line?: number;
}

type SymbolMatch = {
  file?: string;
  file_path?: string;
  line?: number;
};

export function formatToolResult(result: ServiceToolResult): string {
  const content = result.content.join("\n\n").trim();
  if (content.length > 0) {
    return content;
  }

  if (result.error && result.error.trim().length > 0) {
    return result.error;
  }

  return `${result.name} returned no content.`;
}

export function tryParseJsonContent<T>(result: ServiceToolResult): T | undefined {
  if (result.content.length !== 1) {
    return undefined;
  }

  try {
    return JSON.parse(result.content[0]) as T;
  } catch {
    return undefined;
  }
}

function isSymbolMatch(value: unknown): value is SymbolMatch {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.file === "string"
    || typeof candidate.file_path === "string";
}

function isNestedSymbolContainer(value: unknown): value is { symbol?: SymbolMatch; location?: SymbolMatch } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return isSymbolMatch(candidate.symbol) || isSymbolMatch(candidate.location);
}

function toSymbolLocation(match: SymbolMatch): SymbolLocation | undefined {
  const file = match.file ?? match.file_path;
  if (!file) {
    return undefined;
  }

  return {
    file,
    line: typeof match.line === "number" ? match.line : undefined,
  };
}

export function extractFirstSymbolLocation(result: ServiceToolResult): SymbolLocation | undefined {
  const parsed = tryParseJsonContent<unknown>(result);
  if (!parsed) {
    return undefined;
  }

  if (Array.isArray(parsed)) {
    const first = parsed.find(isSymbolMatch);
    return first ? toSymbolLocation(first) : undefined;
  }

  if (isSymbolMatch(parsed)) {
    return toSymbolLocation(parsed);
  }

  if (isNestedSymbolContainer(parsed)) {
    return toSymbolLocation(parsed.symbol ?? parsed.location ?? {});
  }

  return undefined;
}