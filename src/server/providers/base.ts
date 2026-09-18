import type {
  ChatMessage,
  ModelParameters,
  ModelResult,
  ModelTarget,
  ProviderId,
} from "../../shared/types.js";

export interface ProviderCallInput {
  runId: string;
  target: ModelTarget;
  systemPrompt?: string;
  messages: ChatMessage[];
}

export interface ProviderCallOutput {
  text: string;
  usage?: ModelResult["usage"];
  finishReason?: string;
  rawRequestId?: string;
  /**
   * The model id the vendor says actually served the request. Aliases such as
   * "latest" get repointed without notice, so a study needs the resolved id
   * rather than only the one that was asked for.
   */
  reportedModel?: string;
}

export type ProviderAdapter = (input: ProviderCallInput) => Promise<ProviderCallOutput>;

export function clampSampling(parameters: ModelParameters) {
  return {
    temperature:
      parameters.temperature === undefined
        ? undefined
        : Math.max(0, Math.min(2, parameters.temperature)),
    topP:
      parameters.topP === undefined ? undefined : Math.max(0, Math.min(1, parameters.topP)),
    maxTokens:
      parameters.maxTokens === undefined
        ? undefined
        : Math.max(1, Math.floor(parameters.maxTokens)),
    seed:
      parameters.seed === undefined ? undefined : Math.floor(parameters.seed),
  };
}

export function requireKey(provider: ProviderId, key: string | undefined): string {
  if (!key) throw new Error(`${provider} API key is not configured on the server.`);
  return key;
}

export function effectiveParameters(target: ModelTarget): ModelParameters {
  const p = clampSampling(target.parameters);
  const effective: ModelParameters = {};

  if (p.maxTokens !== undefined) effective.maxTokens = p.maxTokens;

  const openAIAstra = target.provider === "openai" && target.model.startsWith("gpt-6-astra");
  const modernGemini = target.provider === "google" && /^gemini-3\.(?:5|6|7|8)/.test(target.model);
  const modernClaude =
    target.provider === "anthropic" &&
    (
      /^claude-(?:fable|mythos)-5(?:-|$)/.test(target.model) ||
      /^claude-opus-(?:4-[78]|5)(?:-|$)/.test(target.model) ||
      /^claude-sonnet-5(?:-|$)/.test(target.model)
    );

  if (!openAIAstra && !modernGemini && !modernClaude) {
    if (p.temperature !== undefined) effective.temperature = p.temperature;
    if (p.topP !== undefined) effective.topP = p.topP;
  }

  if (target.provider === "google" && !modernGemini && p.seed !== undefined) {
    effective.seed = p.seed;
  }

  const requestedEffort = target.parameters.reasoningEffort;
  if (requestedEffort) {
    if (target.provider === "openai") {
      const allowed = openAIAstra
        ? ["low", "medium", "high", "xhigh", "max"]
        : ["none", "low", "medium", "high", "xhigh", "max"];
      if (allowed.includes(requestedEffort)) effective.reasoningEffort = requestedEffort;
    } else if (target.provider === "xai") {
      if (["low", "medium", "high", "xhigh"].includes(requestedEffort)) {
        effective.reasoningEffort = requestedEffort;
      }
    } else if (target.provider === "anthropic") {
      const effortSupported =
        /^claude-(?:fable|mythos)-5(?:-|$)/.test(target.model) ||
        /^claude-opus-(?:4-[5-9]|5)(?:-|$)/.test(target.model) ||
        /^claude-sonnet-(?:4-6|5)(?:-|$)/.test(target.model);
      if (effortSupported && ["low", "medium", "high", "xhigh", "max"].includes(requestedEffort)) {
        effective.reasoningEffort = requestedEffort;
      }
    }
  }

  if (
    target.provider === "google" &&
    target.model.startsWith("gemini-3") &&
    target.parameters.thinkingLevel &&
    ["low", "medium", "high"].includes(target.parameters.thinkingLevel)
  ) {
    effective.thinkingLevel = target.parameters.thinkingLevel;
  }

  return effective;
}
