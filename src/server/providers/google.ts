import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { ProviderAdapter } from "./base.js";
import { clampSampling, requireKey } from "./base.js";

export const callGoogle: ProviderAdapter = async ({ target, systemPrompt, messages }) => {
  const client = new GoogleGenAI({ apiKey: requireKey("google", process.env.GOOGLE_API_KEY) });
  const p = clampSampling(target.parameters);
  const isGemini38 = target.model.startsWith("gemini-3.8");
  const thinkingLevel = target.parameters.thinkingLevel
    ? ({ low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH } as const)[target.parameters.thinkingLevel]
    : undefined;

  const response = await client.models.generateContent({
    model: target.model,
    contents: messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    config: {
      systemInstruction: systemPrompt || undefined,
      maxOutputTokens: p.maxTokens,
      // Gemini 3.8 deprecates sampling controls; keep them available for models that support them.
      temperature: isGemini38 ? undefined : p.temperature,
      topP: isGemini38 ? undefined : p.topP,
      seed: isGemini38 ? undefined : p.seed,
      thinkingConfig: thinkingLevel ? { thinkingLevel } : undefined,
    },
  });

  const usage = response.usageMetadata;
  return {
    text: response.text ?? "",
    usage: usage
      ? {
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
        }
      : undefined,
    finishReason: response.candidates?.[0]?.finishReason,
    reportedModel: response.modelVersion ?? undefined,
  };
};
