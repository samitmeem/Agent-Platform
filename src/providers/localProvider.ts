import type {
  ModelProvider,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
} from "./base";

export interface LocalModelProviderOptions {
  endpoint?: string;
  modelName?: string;
  apiFormat: "ollama" | "openai";
  apiKey?: string;
}

export class LocalModelProvider implements ModelProvider {
  public readonly kind = "local" as const;

  public constructor(
    public readonly displayName: string,
    private readonly options: LocalModelProviderOptions,
  ) {}

  private get endpoint(): string | undefined {
    return this.options.endpoint?.replace(/\/+$/, "");
  }

  public async availability(): Promise<ProviderAvailability> {
    if (!this.endpoint) {
      return {
        status: "unavailable",
        reason: "Set agentPlatform.localEndpoint to enable a local model runtime.",
      };
    }

    if (!this.options.modelName) {
      return {
        status: "unavailable",
        reason: "Set agentPlatform.localModelName to select the local model to use.",
      };
    }

    try {
      const response = await fetch(
        this.options.apiFormat === "ollama"
          ? `${this.endpoint}/api/tags`
          : `${this.endpoint}/models`,
        { headers: this.buildHeaders() },
      );

      if (!response.ok) {
        return {
          status: "unavailable",
          reason: `Local runtime responded with HTTP ${response.status}.`,
          modelId: this.options.modelName,
        };
      }

      const payload = await response.json() as Record<string, unknown>;
      const modelFound = this.options.apiFormat === "ollama"
        ? Array.isArray(payload.models) && payload.models.some((item) => {
          const name = typeof item === "object" && item && "name" in item ? String((item as { name: unknown }).name) : "";
          return name === this.options.modelName || name.startsWith(`${this.options.modelName}:`);
        })
        : Array.isArray(payload.data) && payload.data.some((item) => {
          const id = typeof item === "object" && item && "id" in item ? String((item as { id: unknown }).id) : "";
          return id === this.options.modelName;
        });

      return {
        status: modelFound ? "available" : "unavailable",
        reason: modelFound
          ? "Local model runtime is reachable and the configured model is available."
          : "Local runtime is reachable, but the configured model was not reported by the endpoint.",
        modelId: this.options.modelName,
        vendor: this.options.apiFormat === "ollama" ? "ollama" : "openai-compatible",
      };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : String(error),
        modelId: this.options.modelName,
      };
    }
  }

  public async capabilities(): Promise<ProviderCapabilities> {
    return {
      tools: false,
      streaming: false,
      structuredOutput: false,
    };
  }

  public async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    if (!this.endpoint || !this.options.modelName) {
      throw new Error("Local model runtime is not configured. Set agentPlatform.localEndpoint and localModelName.");
    }

    const response = await fetch(
      this.options.apiFormat === "ollama"
        ? `${this.endpoint}/api/chat`
        : `${this.endpoint}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.buildHeaders(),
        },
        body: JSON.stringify(
          this.options.apiFormat === "ollama"
            ? {
              model: this.options.modelName,
              stream: false,
              messages: request.messages,
            }
            : {
              model: this.options.modelName,
              stream: false,
              messages: request.messages,
            },
        ),
      },
    );

    if (!response.ok) {
      throw new Error(`Local model request failed with HTTP ${response.status}.`);
    }

    const payload = await response.json() as Record<string, unknown>;
    const text = this.options.apiFormat === "ollama"
      ? this.extractOllamaText(payload)
      : this.extractOpenAiText(payload);
    if (!text) {
      throw new Error("Local model response did not include any assistant text.");
    }

    await request.onTextChunk?.(text);
    return {
      provider: this.kind,
      modelId: this.options.modelName,
      vendor: this.options.apiFormat === "ollama" ? "ollama" : "openai-compatible",
      text,
      chunks: [text],
    };
  }

  private buildHeaders(): Record<string, string> {
    if (!this.options.apiKey) {
      return {};
    }

    return {
      Authorization: `Bearer ${this.options.apiKey}`,
    };
  }

  private extractOllamaText(payload: Record<string, unknown>): string | undefined {
    const message = payload.message;
    if (!message || typeof message !== "object") {
      return undefined;
    }

    const content = (message as { content?: unknown }).content;
    return typeof content === "string" ? content.trim() : undefined;
  }

  private extractOpenAiText(payload: Record<string, unknown>): string | undefined {
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return undefined;
    }

    const first = choices[0];
    if (!first || typeof first !== "object") {
      return undefined;
    }

    const message = (first as { message?: unknown }).message;
    if (!message || typeof message !== "object") {
      return undefined;
    }

    const content = (message as { content?: unknown }).content;
    return typeof content === "string" ? content.trim() : undefined;
  }
}