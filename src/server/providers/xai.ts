import OpenAI from "openai";
import type { ProviderAdapter } from "./base.js";
import { clampSampling, requireKey, openAIInput } from "./base.js";

export const callXAI: ProviderAdapter = async ({ target, systemPrompt, messages, images = [], signal }) => {
  const client = new OpenAI({
    apiKey: requireKey("xai", process.env.XAI_API_KEY),
    baseURL: "https://api.x.ai/v1",
    maxRetries: 0,
  });
  const p = clampSampling(target.parameters);

  const response = await client.responses.create({
    model: target.model,
    instructions: systemPrompt || undefined,
    input: openAIInput(messages, images),
    temperature: p.temperature,
    top_p: p.topP,
    max_output_tokens: p.maxTokens,
    reasoning: ["low", "medium", "high", "xhigh"].includes(target.parameters.reasoningEffort ?? "")
      ? ({ effort: target.parameters.reasoningEffort } as any)
      : undefined,
  }, { signal });

  return {
    text: response.output_text ?? "",
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
    rawRequestId: response.id,
    finishReason: response.status ?? undefined,
    reportedModel: response.model ?? undefined,
  };
};
