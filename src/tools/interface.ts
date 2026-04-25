export type ToolSafetyClass = "read" | "memory" | "edit" | "test" | "command" | "destructive";

export interface ToolResult {
  name: string;
  ok: boolean;
  content: string[];
  error?: string | null;
}

export interface ToolDefinition {
  name: string;
  category: string;
  description: string;
  safetyClass: ToolSafetyClass;
  mutatesWorkspace: boolean;
  requiresApprovalByDefault: boolean;
}

/**
 * Declares which tool names a provider uses for memory operations.
 * The core agent resolves these at runtime so tool names are never hardcoded in core code.
 */
export interface MemoryCapability {
  searchToolName: string;
  sessionHistoryToolName: string;
  saveToolName: string;
}

export interface SymbolLocation {
  file: string;
  line?: number;
}

export interface ToolProvider {
  readonly id: string;
  readonly displayName: string;
  /** Optional: declare memory capability so core agent resolves tool names dynamically. */
  readonly memoryCapability?: MemoryCapability;
  isAvailable(): Promise<boolean>;
  listTools(): Promise<ToolDefinition[]>;
  invokeTool(
    name: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
  ): Promise<ToolResult>;
  dispose(): Promise<void>;
}

export function formatToolResult(result: ToolResult): string {
  const content = result.content.join("\n\n").trim();
  if (content.length > 0) {
    return content;
  }

  if (result.error && result.error.trim().length > 0) {
    return result.error;
  }

  return `${result.name} returned no content.`;
}

export function tryParseJsonContent<T>(result: ToolResult): T | undefined {
  if (result.content.length !== 1) {
    return undefined;
  }

  try {
    return JSON.parse(result.content[0]) as T;
  } catch {
    return undefined;
  }
}

type SymbolMatch = { file?: string; file_path?: string; line?: number };

function isSymbolMatch(value: unknown): value is SymbolMatch {
  if (!value || typeof value !== "object") { return false; }
  const c = value as Record<string, unknown>;
  return typeof c.file === "string" || typeof c.file_path === "string";
}

function isNestedSymbolContainer(value: unknown): value is { symbol?: SymbolMatch; location?: SymbolMatch } {
  if (!value || typeof value !== "object") { return false; }
  const c = value as Record<string, unknown>;
  return isSymbolMatch(c["symbol"]) || isSymbolMatch(c["location"]);
}

function toSymbolLocation(match: SymbolMatch): SymbolLocation | undefined {
  const file = match.file ?? match.file_path;
  if (!file) { return undefined; }
  return { file, line: typeof match.line === "number" ? match.line : undefined };
}

/**
 * Extracts a symbol location from any ToolResult whose content[0] is a JSON object or array.
 * Replaces the adapter-specific extractFirstSymbolLocation — no cast required.
 */
export function extractSymbolLocation(result: ToolResult): SymbolLocation | undefined {
  const parsed = tryParseJsonContent<unknown>(result);
  if (!parsed) { return undefined; }
  if (Array.isArray(parsed)) {
    const first = parsed.find(isSymbolMatch);
    return first ? toSymbolLocation(first) : undefined;
  }
  if (isSymbolMatch(parsed)) { return toSymbolLocation(parsed); }
  if (isNestedSymbolContainer(parsed)) { return toSymbolLocation(parsed.symbol ?? parsed.location ?? {}); }
  return undefined;
}
