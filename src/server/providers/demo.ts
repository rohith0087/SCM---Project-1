import type { ProviderAdapter } from "./base.js";

const flavor = {
  openai: "Structured, concise synthesis with explicit assumptions.",
  anthropic: "Careful reasoning with nuance and caveats.",
  google: "Broad synthesis with a practical framing.",
  xai: "Direct answer with compact supporting rationale.",
};

export const callDemo: ProviderAdapter = async ({ target, messages }) => {
  const prompt = messages[messages.length - 1]?.content ?? "";
  const delay = 350 + Math.floor(Math.random() * 900);
  await new Promise((resolve) => setTimeout(resolve, delay));
  const text = [
    `**Demo response from ${target.model}**`,
    "",
    flavor[target.provider],
    "",
    `Prompt received: “${prompt.slice(0, 220)}${prompt.length > 220 ? "…" : ""}”`,
    "",
    "This is synthetic output from DEMO_MODE. Add provider API keys and set DEMO_MODE=false for real model calls.",
  ].join("\n");

  const inputTokens = Math.max(8, Math.ceil(prompt.length / 4));
  const outputTokens = Math.max(20, Math.ceil(text.length / 4));
  return {
    text,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    finishReason: "demo_complete",
    rawRequestId: `demo_${crypto.randomUUID()}`,
  };
};
