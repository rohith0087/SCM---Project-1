import type { ProviderId } from "../../shared/types.js";
import type { ProviderAdapter } from "./base.js";
import { callAnthropic } from "./anthropic.js";
import { callDemo } from "./demo.js";
import { callGoogle } from "./google.js";
import { callOpenAI } from "./openai.js";
import { callXAI } from "./xai.js";
import { isDemoMode } from "../catalog.js";

const adapters: Record<ProviderId, ProviderAdapter> = {
  openai: callOpenAI,
  anthropic: callAnthropic,
  google: callGoogle,
  xai: callXAI,
};

export function getProviderAdapter(provider: ProviderId): ProviderAdapter {
  return isDemoMode() ? callDemo : adapters[provider];
}
