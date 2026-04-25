# Architectural Refactor Plan — Decouple from Token-Savior

## Problem Statement

The current implementation treats token-savior as the core system instead of a tool dependency. The agent layer, tool router, tool registry, and extension entry point are all directly coupled to `BackendGateway` and `ServiceToolResult`, creating lock-in that violates separation of concerns and prevents extensibility.

---

## Coupling Points Identified

### 1. `ServiceToolResult` leaks through the entire agent layer
`src/backend/protocol.ts` defines `ServiceToolResult`. This type is imported directly by:
- `src/agent/planner.ts`
- `src/agent/runtime.ts`
- `src/agent/toolRouter.ts`
- `src/agent/toolRegistry.ts` (via `BackendGateway`)

### 2. `ToolRouter` depends on the concrete `BackendGateway` class
```ts
export interface ToolRouterDependencies {
  gateway: BackendGateway;  // concrete class, not an abstraction
}
```

### 3. `ToolRegistry` depends directly on `BackendGateway`
```ts
public async refresh(gateway: BackendGateway, workspaceRoot: string)
```

### 4. `processManager.ts` hard-codes token-savior's module name in shared infrastructure
```ts
const serviceModule = config.serviceModule ?? "token_savior.service_api.server";
```

### 5. All 19 tool policies are static token-savior tool names
`src/policies/toolPolicy.ts` contains a hardcoded map of token-savior tool names with no registration API.

### 6. Extension cannot operate without the backend
`BackendGateway` is unconditionally instantiated. There is no no-tools mode.

---

## Target Architecture

```
Agent Platform (VS Code Extension)
        ↓
Agent Layer (orchestration — no backend imports)
        ↓
ToolProviderRegistry (generic, pluggable)
   ├── TokenSaviorToolProvider (adapter)
   ├── (future tool providers)
        ↓
LLM Layer (Copilot / local models)
```

---

## Refactor Plan

### Phase 1 — Define the generic Tool Interface

**New file: `src/tools/interface.ts`**

```ts
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

export interface ToolProvider {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  listTools(): Promise<ToolDefinition[]>;
  invokeTool(name: string, args: Record<string, unknown>, workspaceRoot: string): Promise<ToolResult>;
  dispose(): Promise<void>;
}
```

**New file: `src/tools/providerRegistry.ts`**

A `ToolProviderRegistry` that:
- Holds `ToolProvider[]`
- Exposes `registerProvider(p: ToolProvider)`
- Exposes `listAllTools(): Promise<ToolDefinition[]>` (fan-out across providers)
- Exposes `routeTool(name, args, root): Promise<ToolResult>` (finds the right provider)
- Returns a graceful no-op `ToolResult` if no provider can handle the tool

---

### Phase 2 — Move `src/backend/` into an adapter

**Rename: `src/backend/` → `src/adapters/tokenSavior/`**

No logic changes — just relocation. Files become internal to the adapter:

```
src/adapters/tokenSavior/
  adapter.ts        ← NEW: implements ToolProvider
  gateway.ts        ← moved
  processManager.ts ← moved (serviceModule default stays here, not in core)
  client.ts         ← moved
  protocol.ts       ← moved (ServiceToolResult stays here, not exported to agent layer)
```

**New file: `src/adapters/tokenSavior/adapter.ts`**

```ts
export class TokenSaviorToolProvider implements ToolProvider {
  readonly id = "token-savior";
  readonly displayName = "Token Savior";
  // Wraps BackendGateway internally
  // Maps ServiceToolResult → ToolResult (adapter pattern)
  // Registers its own tool policies via the ToolPolicyRegistry
}
```

`ServiceToolResult` becomes an internal implementation detail, invisible to the rest of the system.

---

### Phase 3 — Make tool policies dynamic

**Modify: `src/policies/toolPolicy.ts`**

Replace the static `TOOL_POLICIES` map with a registry:

```ts
export class ToolPolicyRegistry {
  private policies = new Map<string, ToolPolicy>();
  register(policies: ToolPolicy[]): void { ... }
  resolve(toolName: string): ToolPolicy { ... }  // unknown tools fall back to safe defaults
}
```

`TokenSaviorToolProvider.activate()` calls `policyRegistry.register([...tokenSaviorPolicies])`.
New providers register their own policies. The core has zero hardcoded tool names.

---

### Phase 4 — Decouple the agent layer

**Modify: `src/agent/toolRouter.ts`**
```ts
// Replace:
export interface ToolRouterDependencies {
  gateway: BackendGateway;
}
// With:
export interface ToolRouterDependencies {
  toolProviderRegistry: ToolProviderRegistry;
}
```

**Modify: `src/agent/toolRegistry.ts`**

Replace `refresh(gateway: BackendGateway)` with `refresh(registry: ToolProviderRegistry)`.

**Modify: `src/agent/runtime.ts` and `src/agent/planner.ts`**

Remove all imports from `../backend/protocol`. Use `ToolResult` from `src/tools/interface.ts`.
Move `formatToolResult`, `tryParseJsonContent` to `src/tools/interface.ts` as generic utilities.

**Modify: `src/agent/types.ts`**

Remove the static `AgentToolName` union. Use `string` (dynamic discovery via FIX-6 is already in place).

---

### Phase 5 — Make the extension no-tools capable

**Modify: `src/extension.ts`**

```ts
const toolProviderRegistry = new ToolProviderRegistry(policyRegistry);

// Conditionally register TokenSaviorToolProvider
if (tokenSaviorEnabled) {
  const provider = new TokenSaviorToolProvider(launchConfig, policyRegistry);
  toolProviderRegistry.registerProvider(provider);
}

// Agent layer works regardless — with zero providers it answers directly
```

Status bar and health checks become adapter-specific concerns surfaced through `ToolProvider.isAvailable()`, not core extension dependencies.

---

### Phase 6 — Clean up `src/config.ts`

Remove `loadBackendLaunchConfig()` from the core config module. Move it into `src/adapters/tokenSavior/adapter.ts` — it is adapter-specific configuration, not platform configuration.

---

## File Change Summary

| Action | File |
|---|---|
| **New** | `src/tools/interface.ts` |
| **New** | `src/tools/providerRegistry.ts` |
| **New** | `src/adapters/tokenSavior/adapter.ts` |
| **Move** | `src/backend/` → `src/adapters/tokenSavior/` |
| **Modify** | `src/agent/types.ts` — remove static `AgentToolName` union |
| **Modify** | `src/agent/toolRouter.ts` — depend on `ToolProviderRegistry` not `BackendGateway` |
| **Modify** | `src/agent/toolRegistry.ts` — depend on `ToolProviderRegistry` not `BackendGateway` |
| **Modify** | `src/agent/runtime.ts` — use `ToolResult` not `ServiceToolResult` |
| **Modify** | `src/agent/planner.ts` — remove `../backend/protocol` import |
| **Modify** | `src/policies/toolPolicy.ts` — replace static map with `ToolPolicyRegistry` |
| **Modify** | `src/config.ts` — remove `loadBackendLaunchConfig` |
| **Modify** | `src/extension.ts` — conditional adapter instantiation |

---

## Validation Criteria

| Criterion | How it is met |
|---|---|
| Extension works with no tools | `ToolProviderRegistry` with 0 providers → agent answers directly |
| New tools added without touching core | Implement `ToolProvider`, call `registry.registerProvider()` |
| token-savior removed without breaking system | Delete `src/adapters/tokenSavior/`, unregister provider — nothing else changes |
| Agent layer has no backend imports | All agent files import from `src/tools/interface.ts` only |
| Tool policies are not hardcoded | Each provider registers its own policies at activation time |
