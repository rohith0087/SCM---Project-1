import type { ProviderId, ProviderStatus } from "../shared/types.js";

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
};

export const FALLBACK_MODELS: Record<ProviderId, string[]> = {
  openai: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"],
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5-1", "claude-sonnet-4-6", "claude-haiku-4-5"],
  google: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.1-pro-preview", "gemini-2.5-pro"],
  xai: ["grok-4.6", "grok-4", "grok-3"],
};

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE?.toLowerCase() === "true";
}

export function providerConfigured(provider: ProviderId): boolean {
  if (isDemoMode()) return true;
  const keys: Record<ProviderId, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    xai: process.env.XAI_API_KEY,
  };
  return Boolean(keys[provider]);
}

export function providerStatuses(): ProviderStatus[] {
  return (Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    configured: providerConfigured(id),
    demoMode: isDemoMode(),
  }));
}
