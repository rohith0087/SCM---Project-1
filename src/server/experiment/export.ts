import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExperimentSpec, RunRecord } from "../../shared/experiment.js";
import { buildConditions } from "./design.js";

/**
 * Exports results in tidy long format: one row per API call, one column per
 * variable. That is the shape R, SPSS, pandas and Excel pivot tables all
 * expect, so no reshaping is needed before analysis.
 *
 * Nothing is aggregated or filtered here. Invalid and failed runs are exported
 * with their status so the analyst decides what to exclude, rather than the
 * tool silently deciding for them.
 */

function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replaceAll('"', '""')}"`;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

export function resultsCsv(spec: ExperimentSpec, records: RunRecord[]): string {
  const factorIds = spec.factors.map((factor) => factor.id);
  const measureIds = spec.measures.map((measure) => measure.id);

  const header = [
    "experiment_id",
    "experiment_version",
    "run_key",
    "condition_id",
    "exec_order",
    "replicate",
    ...factorIds.flatMap((id) => [id, `${id}_label`]),
    "model_id",
    "provider",
    "model_requested",
    "model_reported",
    ...measureIds,
    "parse_status",
    "parse_notes",
    "error",
    "finish_reason",
    "latency_ms",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "temperature",
    "top_p",
    "max_tokens",
    "seed",
    "reasoning_effort",
    "thinking_level",
    "started_at",
    "completed_at",
    "attempt",
    "request_id",
    "system_prompt_hash",
    "user_prompt_hash",
    "raw_text",
  ];

  const rows = records.map((record) => [
    record.experimentId,
    record.experimentVersion,
    record.runKey,
    record.conditionId,
    record.order,
    record.replicate,
    ...factorIds.flatMap((id) => [record.cells?.[id], record.cellLabels?.[id]]),
    record.modelId,
    record.provider,
    record.model,
    record.reportedModel,
    ...measureIds.map((id) => record.parsed?.[id]),
    record.parseStatus,
    record.parseNotes,
    record.error,
    record.finishReason,
    record.latencyMs,
    record.usage?.inputTokens,
    record.usage?.outputTokens,
    record.usage?.totalTokens,
    record.parameters?.temperature,
    record.parameters?.topP,
    record.parameters?.maxTokens,
    record.parameters?.seed,
    record.parameters?.reasoningEffort,
    record.parameters?.thinkingLevel,
    record.startedAt,
    record.completedAt,
    record.attempt,
    record.requestId,
    record.systemPromptHash,
    record.userPromptHash,
    record.rawText,
  ]);

  return toCsv(header, rows);
}

/** The codebook: every condition with the exact prompts it sent. */
export function conditionsCsv(spec: ExperimentSpec): string {
  const factorIds = spec.factors.map((factor) => factor.id);
  const header = [
    "condition_id",
    ...factorIds.flatMap((id) => [id, `${id}_label`]),
    "system_prompt",
    "user_prompt",
  ];
  const rows = buildConditions(spec).map((condition) => [
    condition.id,
    ...factorIds.flatMap((id) => [condition.cells[id], condition.cellLabels[id]]),
    condition.systemPrompt,
    condition.userPrompt,
  ]);
  return toCsv(header, rows);
}

export interface CompletionRow {
  conditionId: string;
  modelId: string;
  expected: number;
  ok: number;
  partial: number;
  invalid: number;
  missing: number;
  failed: number;
}

/** Per cell counts, so gaps are visible before anyone runs a statistic. */
export function completionRows(spec: ExperimentSpec, records: RunRecord[]): CompletionRow[] {
  const index = new Map<string, CompletionRow>();

  for (const condition of buildConditions(spec)) {
    for (const model of spec.models) {
      index.set(`${condition.id}|${model.id}`, {
        conditionId: condition.id,
        modelId: model.id,
        expected: spec.replicates,
        ok: 0,
        partial: 0,
        invalid: 0,
        missing: 0,
        failed: 0,
      });
    }
  }

  for (const record of records) {
    const row = index.get(`${record.conditionId}|${record.modelId}`);
    if (!row) continue;
    if (record.error) row.failed += 1;
    else if (record.parseStatus === "ok") row.ok += 1;
    else if (record.parseStatus === "partial") row.partial += 1;
    else if (record.parseStatus === "invalid") row.invalid += 1;
    else row.missing += 1;
  }

  return [...index.values()];
}

export function completionCsv(spec: ExperimentSpec, records: RunRecord[]): string {
  const header = ["condition_id", "model_id", "expected", "ok", "partial", "invalid", "missing", "failed", "usable_pct"];
  const rows = completionRows(spec, records).map((row) => [
    row.conditionId,
    row.modelId,
    row.expected,
    row.ok,
    row.partial,
    row.invalid,
    row.missing,
    row.failed,
    row.expected ? (((row.ok + row.partial) / row.expected) * 100).toFixed(1) : "",
  ]);
  return toCsv(header, rows);
}

export interface ExportResult {
  files: string[];
}

export async function writeExports(
  spec: ExperimentSpec,
  records: RunRecord[],
  dir: string,
): Promise<ExportResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const files = [
    { name: `results-${stamp}.csv`, contents: resultsCsv(spec, records) },
    { name: `conditions-${stamp}.csv`, contents: conditionsCsv(spec) },
    { name: `completion-${stamp}.csv`, contents: completionCsv(spec, records) },
  ];

  const written: string[] = [];
  for (const file of files) {
    const target = path.join(dir, file.name);
    // A leading BOM keeps Excel from mangling non ASCII characters such as the
    // em dash in the driver reports.
    await writeFile(target, `﻿${file.contents}`, "utf8");
    written.push(target);
  }
  return { files: written };
}
