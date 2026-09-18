import type { ProviderId } from "../shared/types.js";
import { FALLBACK_MODELS } from "./catalog.js";

const cache = new Map<ProviderId, { at: number; models: string[] }>();
const TTL_MS = 5 * 60 * 1000;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

async function loadOpenAIModels(): Promise<string[]> {
  if (!process.env.OPENAI_API_KEY) return [];
  const json = await fetchJson("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
  return uniqueSorted((json.data ?? []).map((model: any) => model.id).filter((id: string) => /gpt|o\d|chat/i.test(id)));
}

async function loadXAIModels(): Promise<string[]> {
  if (!process.env.XAI_API_KEY) return [];
  const json = await fetchJson("https://api.x.ai/v1/models", {
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
  });
  return uniqueSorted((json.data ?? []).map((model: any) => model.id).filter((id: string) => /grok/i.test(id)));
}

async function loadAnthropicModels(): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const json = await fetchJson("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
  });
  return uniqueSorted((json.data ?? []).map((model: any) => model.id));
}

async function loadGoogleModels(): Promise<string[]> {
  if (!process.env.GOOGLE_API_KEY) return [];
  const json = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(process.env.GOOGLE_API_KEY)}`,
  );
  return uniqueSorted(
    (json.models ?? [])
      .filter((model: any) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((model: any) => String(model.name ?? "").replace(/^models\//, ""))
      .filter((id: string) => /gemini/i.test(id)),
  );
}

const loaders: Record<ProviderId, () => Promise<string[]>> = {
  openai: loadOpenAIModels,
  anthropic: loadAnthropicModels,
  google: loadGoogleModels,
  xai: loadXAIModels,
};

export async function getModels(provider: ProviderId, refresh = false): Promise<{ models: string[]; live: boolean }> {
  const cached = cache.get(provider);
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) {
    return { models: cached.models, live: true };
  }

  try {
    const live = await loaders[provider]();
    if (live.length) {
      const models = uniqueSorted([...FALLBACK_MODELS[provider], ...live]);
      cache.set(provider, { at: Date.now(), models });
      return { models, live: true };
    }
  } catch (error) {
    console.warn(`Model catalog refresh failed for ${provider}:`, error);
  }

  return { models: FALLBACK_MODELS[provider], live: false };
}
