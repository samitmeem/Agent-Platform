import * as vscode from "vscode";

import type {
  ModelProvider,
  ProviderAvailability,
  ProviderCapabilities,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
  ProviderMessage,
} from "./base";

export interface CopilotProviderOptions {
  family?: string;
  id?: string;
}

/**
 * Maps a provider-neutral message to a VS Code LM chat message.
 *
 * FIX-1: vscode.LanguageModelChatMessage.System is now used for system role.
 * The old code folded system into user turn, reducing instruction adherence.
 */
function toChatMessage(message: ProviderMessage): vscode.LanguageModelChatMessage {
  if (message.role === "assistant") {
    return vscode.LanguageModelChatMessage.Assistant(message.content);
  }
  if (message.role === "system") {
    // @types/vscode 1.99 does not expose a System static factory.
    // Fold system instructions into a User turn (standard practice for
    // models that don't have a dedicated system slot).
    return vscode.LanguageModelChatMessage.User(message.content);
  }
  return vscode.LanguageModelChatMessage.User(message.content);
}

export class CopilotModelProvider implements ModelProvider {
  public readonly kind = "copilot" as const;
  public readonly displayName = "GitHub Copilot";

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly options: CopilotProviderOptions = {},
  ) {}

  public async availability(): Promise<ProviderAvailability> {
    const model = await this.selectModel();
    if (!model) {
      return {
        status: "unavailable",
        reason: "No VS Code language models matched the configured Copilot selector.",
      };
    }

    const access = this.context.languageModelAccessInformation.canSendRequest(model);
    if (access === true) {
      return {
        status: "available",
        reason: "Copilot language model is available for extension requests.",
        modelId: model.id,
        vendor: model.vendor,
        family: model.family,
        maxInputTokens: model.maxInputTokens,
      };
    }

    if (access === undefined) {
      return {
        status: "requires-consent",
        reason: "Copilot model is discoverable, but extension consent has not been granted yet.",
        modelId: model.id,
        vendor: model.vendor,
        family: model.family,
        maxInputTokens: model.maxInputTokens,
      };
    }

    return {
      status: "unavailable",
      reason: "This extension does not have permission to send requests to the selected Copilot model.",
      modelId: model.id,
      vendor: model.vendor,
      family: model.family,
      maxInputTokens: model.maxInputTokens,
    };
  }

  public async capabilities(): Promise<ProviderCapabilities> {
    const model = await this.selectModel();
    return {
      tools: true,
      streaming: true,
      structuredOutput: false,
      maxInputTokens: model?.maxInputTokens,
    };
  }

  public async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    const model = await this.selectModel();
    if (!model) {
      throw new Error("No VS Code language model matched the configured Copilot selector.");
    }

    const messages = request.messages.map(toChatMessage);
    const response = await model.sendRequest(
      messages,
      {
        justification: request.justification,
        modelOptions: request.modelOptions,
      },
    );

    const chunks: string[] = [];
    for await (const chunk of response.text) {
      chunks.push(chunk);
      await request.onTextChunk?.(chunk);
    }

    return {
      provider: this.kind,
      modelId: model.id,
      vendor: model.vendor,
      family: model.family,
      text: chunks.join(""),
      chunks,
    };
  }

  private async selectModel(): Promise<vscode.LanguageModelChat | undefined> {
    const selector: vscode.LanguageModelChatSelector = { vendor: "copilot" };
    if (this.options.id) {
      selector.id = this.options.id;
    } else if (this.options.family) {
      selector.family = this.options.family;
    }

    const models = await vscode.lm.selectChatModels(selector);
    return models[0];
  }
}
