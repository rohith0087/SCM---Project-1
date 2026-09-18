import type { ResearchSession } from "@shared/types";

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "session";
}

export function exportSessionJson(session: ResearchSession) {
  download(`${safeName(session.title)}.json`, JSON.stringify(session, null, 2), "application/json");
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportSessionCsv(session: ResearchSession) {
  const header = [
    "session_id",
    "session_created_at",
    "turn_id",
    "turn_created_at",
    "system_prompt",
    "prompt",
    "run_id",
    "target_id",
    "provider",
    "model",
    "started_at",
    "completed_at",
    "latency_ms",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "finish_reason",
    "request_id",
    "temperature",
    "top_p",
    "max_tokens",
    "seed",
    "reasoning_effort",
    "thinking_level",
    "error",
    "response",
  ];

  const rows = session.turns.flatMap((turn) =>
    turn.results.map((result) => [
      session.id,
      session.createdAt,
      turn.id,
      turn.createdAt,
      session.systemPrompt,
      turn.prompt,
      result.runId,
      result.targetId,
      result.provider,
      result.model,
      result.startedAt,
      result.completedAt,
      result.latencyMs,
      result.usage?.inputTokens,
      result.usage?.outputTokens,
      result.usage?.totalTokens,
      result.finishReason,
      result.rawRequestId,
      result.parameters.temperature,
      result.parameters.topP,
      result.parameters.maxTokens,
      result.parameters.seed,
      result.parameters.reasoningEffort,
      result.parameters.thinkingLevel,
      result.error,
      result.text,
    ]),
  );

  download(
    `${safeName(session.title)}.csv`,
    [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"),
    "text/csv;charset=utf-8",
  );
}
