import Anthropic from "@anthropic-ai/sdk";
import type { ProviderAdapter } from "./base.js";
import { clampSampling, requireKey } from "./base.js";

function samplingIsRestricted(model: string) {
  return (
    /^claude-(?:fable|mythos)-5(?:-|$)/.test(model) ||
    /^claude-opus-(?:4-[78]|5)(?:-|$)/.test(model) ||
    /^claude-sonnet-5(?:-|$)/.test(model)
  );
}

function supportsEffort(model: string) {
  return (
    /^claude-(?:fable|mythos)-5(?:-|$)/.test(model) ||
    /^claude-opus-(?:4-[5-9]|5)(?:-|$)/.test(model) ||
    /^claude-sonnet-(?:4-6|5)(?:-|$)/.test(model)
  );
}

export const callAnthropic: ProviderAdapter = async ({ target, systemPrompt, messages }) => {
  const client = new Anthropic({ apiKey: requireKey("anthropic", process.env.ANTHROPIC_API_KEY) });
  const p = clampSampling(target.parameters);
  const restrictedSampling = samplingIsRestricted(target.model);
  const effort = target.parameters.reasoningEffort;
  const anthropicEffort =
    supportsEffort(target.model) && effort && ["low", "medium", "high", "xhigh", "max"].includes(effort)
      ? (effort as "low" | "medium" | "high" | "xhigh" | "max")
      : undefined;

  const response = await client.messages.create({
    model: target.model,
    system: systemPrompt || undefined,
    max_tokens: p.maxTokens ?? 2048,
    temperature: restrictedSampling ? undefined : p.temperature,
    top_p: restrictedSampling ? undefined : p.topP,
    output_config: anthropicEffort ? { effort: anthropicEffort } : undefined,
    messages: messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    })),
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");

  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    },
    rawRequestId: response.id,
    finishReason: response.stop_reason ?? undefined,
    reportedModel: response.model ?? undefined,
  };
};
