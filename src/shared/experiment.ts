import type { ModelParameters, ProviderId, UsageStats } from "./types.js";

/**
 * Types for factorial experiments.
 *
 * An experiment is declared as data, not code, so the design can be reviewed,
 * diffed and cited without reading TypeScript. One run is one independent API
 * call: runs never share conversation history, which is what keeps replicates
 * statistically independent.
 */

/** One level of one factor, e.g. the "Jamal Washington" level of "identity". */
export interface FactorLevel {
  id: string;
  label: string;
  /** Substituted into the user prompt template as {{key}}. */
  vars?: Record<string, string>;
  /** When present, this level supplies the system prompt for the condition. */
  systemPrompt?: string;
}

export interface Factor {
  id: string;
  label: string;
  levels: FactorLevel[];
}

/** A model lane under test. Parameters are per lane so effort can differ. */
export interface ExperimentModel {
  id: string;
  provider: ProviderId;
  model: string;
  parameters?: ModelParameters;
}

/** A dependent variable expected back from the model. */
export interface Measure {
  id: string;
  label: string;
  type: "integer" | "number" | "text";
  min?: number;
  max?: number;
  /** When false, a missing value does not make the whole run invalid. */
  required?: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface ConcurrencyPolicy {
  global: number;
  perProvider?: Partial<Record<ProviderId, number>>;
}

export interface ExperimentSpec {
  id: string;
  version: string;
  title: string;
  notes?: string;
  factors: Factor[];
  models: ExperimentModel[];
  /** Independent repeats of every condition on every model. */
  replicates: number;
  userPromptTemplate: string;
  /** Used only when no factor level supplies a system prompt. */
  systemPrompt?: string;
  measures: Measure[];
  /** Fixes the shuffled execution order so a run can be reproduced exactly. */
  seed?: number;
  concurrency?: ConcurrencyPolicy;
  retry?: RetryPolicy;
}

/** One cell of the design: a combination with one level per factor. */
export interface Condition {
  id: string;
  /** factorId -> levelId */
  cells: Record<string, string>;
  /** factorId -> human readable level label, for export columns. */
  cellLabels: Record<string, string>;
  systemPrompt: string;
  userPrompt: string;
}

/** A single planned API call. */
export interface PlannedRun {
  runKey: string;
  conditionId: string;
  cells: Record<string, string>;
  cellLabels: Record<string, string>;
  modelId: string;
  provider: ProviderId;
  model: string;
  parameters: ModelParameters;
  replicate: number;
  /** Position in the randomised execution order, from 1. */
  order: number;
  systemPrompt: string;
  userPrompt: string;
}

export type ParseStatus = "ok" | "partial" | "invalid" | "missing" | "not_attempted";

/** The stored outcome of one call. Raw text is always kept beside the parse. */
export interface RunRecord {
  experimentId: string;
  experimentVersion: string;
  runKey: string;
  conditionId: string;
  cells: Record<string, string>;
  cellLabels: Record<string, string>;
  modelId: string;
  provider: ProviderId;
  model: string;
  /** The model id the vendor reported, which can differ from the one asked for. */
  reportedModel?: string;
  replicate: number;
  order: number;
  attempt: number;
  parameters: ModelParameters;
  systemPromptHash: string;
  userPromptHash: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  usage?: UsageStats;
  finishReason?: string;
  requestId?: string;
  rawText: string;
  parsed?: Record<string, number | string | null>;
  parseStatus: ParseStatus;
  parseNotes?: string;
  /** Transport or API level failure. A refused answer is not an error. */
  error?: string;
}

export interface ExperimentProgress {
  experimentId: string;
  total: number;
  completed: number;
  failed: number;
  invalid: number;
  remaining: number;
  startedAt: string;
  updatedAt: string;
  state: "idle" | "running" | "paused" | "done" | "error";
  message?: string;
}
