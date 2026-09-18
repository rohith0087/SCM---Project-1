import type { ModelParameters, ProviderId, TraceEvent } from "@shared/types";

/**
 * Plain-language layer.
 *
 * The audience for this tool is supply chain teams, not ML engineers, so every
 * vendor term that reaches the screen is translated here in one place. The
 * underlying API contract is unchanged: only the wording differs.
 */

export const VENDOR_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
};

export const VENDOR_BLURB: Record<ProviderId, string> = {
  openai: "The company behind ChatGPT",
  anthropic: "The company behind Claude",
  google: "The company behind Gemini",
  xai: "The company behind Grok",
};

/** Turns an exact API model id into something readable on a slide. */
export function prettyModel(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "No model chosen";

  const words: string[] = [];
  for (const part of trimmed.split("-")) {
    const isNumeric = /^[\d.]+$/.test(part);
    const previous = words[words.length - 1];
    if (isNumeric && previous && /^[\d.]+$/.test(previous)) {
      words[words.length - 1] = `${previous}.${part}`;
      continue;
    }
    if (/^gpt$/i.test(part)) words.push("GPT");
    else if (/^xai$/i.test(part)) words.push("xAI");
    else if (isNumeric) words.push(part);
    else words.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  return words.join(" ");
}

/** "How hard it thinks" options, worded for a business reader. */
export const EFFORT_LABELS: Record<string, string> = {
  none: "Off — answer immediately",
  minimal: "Minimal",
  low: "Light thinking — fastest",
  medium: "Balanced",
  high: "Deep thinking — slower",
  xhigh: "Very deep thinking",
  max: "Maximum thinking — slowest",
};

export const THINKING_LABELS: Record<string, string> = {
  low: "Light thinking — fastest",
  medium: "Balanced",
  high: "Deep thinking — slower",
};

export function effortLabel(value?: string): string | undefined {
  if (!value) return undefined;
  return EFFORT_LABELS[value] ?? THINKING_LABELS[value] ?? value;
}

/** Short form for chips, where the full sentence would not fit. */
export function effortShort(value?: string): string | undefined {
  if (!value) return undefined;
  const map: Record<string, string> = {
    none: "no thinking",
    minimal: "minimal thinking",
    low: "light thinking",
    medium: "balanced thinking",
    high: "deep thinking",
    xhigh: "very deep thinking",
    max: "maximum thinking",
  };
  return map[value] ?? value;
}

/** 1,240 ms reads badly next to 12,400 ms. Seconds are easier to compare. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)} sec`;
  return `${Math.round(ms / 1000)} sec`;
}

/** Tokens mean nothing to most readers; words do. */
export function tokensToWords(tokens: number): string {
  const words = Math.round(tokens * 0.75);
  if (words >= 1000) return `about ${(words / 1000).toFixed(1)}k words`;
  return `about ${words} words`;
}

export function formatCount(value?: number): string | undefined {
  return value == null ? undefined : value.toLocaleString();
}

/** Provider finish codes, softened into a status a reader can act on. */
export function finishLabel(reason?: string, hasError?: boolean): { text: string; tone: "ok" | "warn" | "bad" } {
  if (hasError) return { text: "Failed", tone: "bad" };
  if (!reason) return { text: "Done", tone: "ok" };
  const normalized = reason.toLowerCase();
  if (normalized.includes("length") || normalized.includes("max_tokens")) {
    return { text: "Cut off — answer hit the length limit", tone: "warn" };
  }
  if (normalized.includes("filter") || normalized.includes("safety") || normalized.includes("refus")) {
    return { text: "Stopped by the vendor's content filter", tone: "warn" };
  }
  if (normalized.includes("demo")) return { text: "Done (demo)", tone: "ok" };
  return { text: "Done", tone: "ok" };
}

/** A one-line summary of the settings actually sent, in plain words. */
export function describeParameters(parameters: ModelParameters): string {
  const parts: string[] = [];
  if (parameters.maxTokens) parts.push(`up to ${parameters.maxTokens.toLocaleString()} tokens`);
  if (parameters.temperature !== undefined) parts.push(`creativity ${parameters.temperature}`);
  if (parameters.topP !== undefined) parts.push(`word variety ${parameters.topP}`);
  if (parameters.seed !== undefined) parts.push(`seed ${parameters.seed}`);
  const thinking = effortShort(parameters.reasoningEffort ?? parameters.thinkingLevel);
  if (thinking) parts.push(thinking);
  if (!parts.length) return "Vendor defaults";
  return parts.join(" · ");
}

/** Rewrites LangGraph stage names as things that happened during the run. */
export function traceHeadline(event: TraceEvent): string {
  const vendor = event.provider ? VENDOR_LABELS[event.provider] : undefined;
  switch (event.stage) {
    case "graph_started":
      return "Run started";
    case "dispatch":
      return "Question sent to every model";
    case "model_started":
      return vendor ? `${vendor} started` : "Model started";
    case "model_completed":
      return vendor ? `${vendor} answered` : "Model answered";
    case "model_failed":
      return vendor ? `${vendor} failed` : "Model failed";
    case "graph_completed":
      return "Run finished";
  }
  // Unreachable for known stages, but keeps a new server stage readable.
  return String(event.stage).replaceAll("_", " ");
}

/** The raw server message is kept, but without the framework vocabulary. */
export function traceDetail(event: TraceEvent): string {
  return event.message
    .replace(/LangGraph run/gi, "Run")
    .replace(/\bmodel lanes?\b/gi, "models")
    .replace(/\blanes?\b/gi, "models")
    .replace(/\bgraph\b/gi, "run");
}
