export type ProviderKind = "copilot" | "local";
export type ProviderMessageRole = "system" | "user" | "assistant";
export type ProviderAvailabilityStatus = "available" | "requires-consent" | "unavailable";

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
}

export interface ProviderCapabilities {
  tools: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  maxInputTokens?: number;
}

export interface ProviderAvailability {
  status: ProviderAvailabilityStatus;
  reason: string;
  modelId?: string;
  vendor?: string;
  family?: string;
  maxInputTokens?: number;
}

export interface ProviderCompletionRequest {
  messages: ProviderMessage[];
  justification?: string;
  modelOptions?: Record<string, unknown>;
  onTextChunk?: (chunk: string) => void | Promise<void>;
}

export interface ProviderCompletionResponse {
  provider: ProviderKind;
  modelId?: string;
  vendor?: string;
  family?: string;
  text: string;
  chunks: string[];
}

export interface ModelProvider {
  readonly kind: ProviderKind;
  readonly displayName: string;
  availability(): Promise<ProviderAvailability>;
  capabilities(): Promise<ProviderCapabilities>;
  complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse>;
}

export interface ProviderSnapshot {
  kind: ProviderKind;
  displayName: string;
  preferred: boolean;
  availability: ProviderAvailability;
}