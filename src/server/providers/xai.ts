import OpenAI from "openai";
import type { ProviderAdapter } from "./base.js";
import { clampSampling, requireKey } from "./base.js";

export const callXAI: ProviderAdapter = async ({ target, systemPrompt, messages }) => {
  const client = new OpenAI({
    apiKey: requireKey("xai", process.env.XAI_API_KEY),
    baseURL: "https://api.x.ai/v1",
  });
  const p = clampSampling(target.parameters);

  const response = await client.responses.create({
    model: target.model,
    instructions: systemPrompt || undefined,
    input: messages.map((message) => ({ role: message.role, content: message.content })),
    temperature: p.temperature,
    top_p: p.topP,
    max_output_tokens: p.maxTokens,
    reasoning: ["low", "medium", "high", "xhigh"].includes(target.parameters.reasoningEffort ?? "")
      ? ({ effort: target.parameters.reasoningEffort } as any)
      : undefined,
  });

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
