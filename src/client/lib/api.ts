import type { CompareRequest, ProviderId, ProviderStatus, StreamEvent } from "@shared/types";

export async function fetchProviders(): Promise<ProviderStatus[]> {
  const response = await fetch("/api/providers");
  if (!response.ok) throw new Error("Could not load provider status.");
  const json = await response.json();
  return json.providers ?? [];
}

export async function fetchModels(provider: ProviderId, refresh = false): Promise<{ models: string[]; live: boolean }> {
  const response = await fetch(`/api/models/${provider}${refresh ? "?refresh=true" : ""}`);
  if (!response.ok) throw new Error(`Could not load ${provider} models.`);
  return response.json();
}

export async function streamComparison(
  request: CompareRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/compare/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Comparison request failed (${response.status}).`);
  }
  if (!response.body) throw new Error("Streaming response body was unavailable.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as StreamEvent);
    }
  }

  if (buffer.trim()) onEvent(JSON.parse(buffer) as StreamEvent);
}
