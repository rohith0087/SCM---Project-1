import OpenAI from "openai";
import type { ProviderAdapter } from "./base.js";
import { clampSampling, requireKey } from "./base.js";

export const callOpenAI: ProviderAdapter = async ({ target, systemPrompt, messages }) => {
  const client = new OpenAI({ apiKey: requireKey("openai", process.env.OPENAI_API_KEY) });
  const p = clampSampling(target.parameters);
  const samplingRestricted = target.model.startsWith("gpt-6-astra");

  const requestedEffort = target.parameters.reasoningEffort;
  const allowedEfforts = target.model.startsWith("gpt-6-astra")
    ? ["low", "medium", "high", "xhigh", "max"]
    : ["none", "low", "medium", "high", "xhigh", "max"];
  const reasoningEffort =
    requestedEffort && allowedEfforts.includes(requestedEffort) ? requestedEffort : undefined;

  const response = await client.responses.create({
    model: target.model,
    instructions: systemPrompt || undefined,
    input: messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    temperature: samplingRestricted ? undefined : p.temperature,
    top_p: samplingRestricted ? undefined : p.topP,
    max_output_tokens: p.maxTokens,
    reasoning: reasoningEffort ? ({ effort: reasoningEffort } as any) : undefined,
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
