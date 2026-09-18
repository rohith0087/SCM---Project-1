import type {
  ExperimentProgress,
  ExperimentSpec,
  PlannedRun,
  RunRecord,
} from "../../shared/experiment.js";
import type { ModelTarget, ProviderId } from "../../shared/types.js";
import { getProviderAdapter } from "../providers/index.js";
import { effectiveParameters } from "../providers/base.js";
import { hash } from "./design.js";
import { parseMeasures } from "./parse.js";
import type { RunStore } from "./store.js";

/**
 * Executes a planned batch.
 *
 * Three properties matter more than speed here:
 *
 *  - Every call is independent. The adapter is handed exactly one user message
 *    and no history, so replicate 12 cannot see replicate 11. Reusing the chat
 *    session would turn 30 samples into one 30 turn conversation.
 *  - Every result reaches disk before the next call starts on that worker, so
 *    an interrupted batch loses at most the calls currently in flight.
 *  - A refusal is data, not an error. Only transport and API failures are
 *    recorded as errors; a model declining to answer is stored with its text.
 */

class Semaphore {
  private available: number;
  private readonly waiting: Array<() => void> = [];

  constructor(count: number) {
    this.available = Math.max(1, count);
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.available += 1;
  }
}

const RETRYABLE = /\b(429|408|409|5\d\d)\b|rate.?limit|overloaded|timeout|timed out|temporarily|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network/i;
const PERMANENT = /\b(400|401|403|404)\b|invalid.?api.?key|not.?found|unsupported|is not configured/i;

export function isRetryable(message: string): boolean {
  if (PERMANENT.test(message) && !RETRYABLE.test(message)) return false;
  return RETRYABLE.test(message);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

export interface RunnerOptions {
  spec: ExperimentSpec;
  store: RunStore;
  runs: PlannedRun[];
  onRecord?: (record: RunRecord) => void;
  onProgress?: (progress: ExperimentProgress) => void;
  signal?: AbortSignal;
}

export async function runExperiment(options: RunnerOptions): Promise<ExperimentProgress> {
  const { spec, store, runs, onRecord, onProgress, signal } = options;
  const retry = spec.retry ?? { maxAttempts: 4, baseDelayMs: 1000 };
  const globalLimit = spec.concurrency?.global ?? 4;
  const globalGate = new Semaphore(globalLimit);
  const startedAt = new Date().toISOString();

  const progress: ExperimentProgress = {
    experimentId: spec.id,
    total: runs.length,
    completed: 0,
    failed: 0,
    invalid: 0,
    remaining: runs.length,
    startedAt,
    updatedAt: startedAt,
    state: runs.length ? "running" : "done",
  };

  const emit = () => {
    progress.remaining = progress.total - progress.completed - progress.failed;
    progress.updatedAt = new Date().toISOString();
    onProgress?.({ ...progress });
  };
  emit();

  // One queue per provider so a slow or rate limited vendor cannot starve the
  // others, with a global gate on top bounding total concurrency.
  const byProvider = new Map<ProviderId, PlannedRun[]>();
  for (const run of runs) {
    const list = byProvider.get(run.provider) ?? [];
    list.push(run);
    byProvider.set(run.provider, list);
  }

  const executeOne = async (run: PlannedRun): Promise<RunRecord> => {
    const target: ModelTarget = {
      id: run.modelId,
      provider: run.provider,
      model: run.model,
      enabled: true,
      parameters: run.parameters,
    };
    const parameters = effectiveParameters(target);
    const adapter = getProviderAdapter(run.provider);

    let attempt = 0;
    let lastError = "";

    while (attempt < retry.maxAttempts) {
      attempt += 1;
      if (signal?.aborted) throw new Error("aborted");

      const startedIso = new Date().toISOString();
      const startedMs = Date.now();

      try {
        await globalGate.acquire();
        let output;
        try {
          output = await adapter({
            runId: crypto.randomUUID(),
            target: { ...target, parameters },
            systemPrompt: run.systemPrompt,
            // One message, no history. This is what keeps replicates independent.
            messages: [{ role: "user", content: run.userPrompt }],
          });
        } finally {
          globalGate.release();
        }

        const completedIso = new Date().toISOString();
        const parsed = parseMeasures(output.text ?? "", spec.measures);

        return {
          experimentId: spec.id,
          experimentVersion: spec.version,
          runKey: run.runKey,
          conditionId: run.conditionId,
          cells: run.cells,
          cellLabels: run.cellLabels,
          modelId: run.modelId,
          provider: run.provider,
          model: run.model,
          reportedModel: output.reportedModel,
          replicate: run.replicate,
          order: run.order,
          attempt,
          parameters,
          systemPromptHash: hash(run.systemPrompt),
          userPromptHash: hash(run.userPrompt),
          startedAt: startedIso,
          completedAt: completedIso,
          latencyMs: Date.now() - startedMs,
          usage: output.usage,
          finishReason: output.finishReason,
          requestId: output.rawRequestId,
          rawText: output.text ?? "",
          parsed: parsed.values,
          parseStatus: parsed.status,
          parseNotes: parsed.notes,
        };
      } catch (error) {
        if (signal?.aborted) throw new Error("aborted");
        lastError = error instanceof Error ? error.message : String(error);

        const canRetry = attempt < retry.maxAttempts && isRetryable(lastError);
        if (!canRetry) {
          const completedIso = new Date().toISOString();
          return {
            experimentId: spec.id,
            experimentVersion: spec.version,
            runKey: run.runKey,
            conditionId: run.conditionId,
            cells: run.cells,
            cellLabels: run.cellLabels,
            modelId: run.modelId,
            provider: run.provider,
            model: run.model,
            replicate: run.replicate,
            order: run.order,
            attempt,
            parameters,
            systemPromptHash: hash(run.systemPrompt),
            userPromptHash: hash(run.userPrompt),
            startedAt: startedIso,
            completedAt: completedIso,
            latencyMs: Date.now() - startedMs,
            rawText: "",
            parseStatus: "not_attempted",
            error: lastError,
          };
        }

        // Exponential backoff with jitter, so retries from parallel workers do
        // not all land on the vendor at the same instant.
        const wait = retry.baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
        await delay(wait, signal);
      }
    }

    throw new Error(lastError || "exhausted retries");
  };

  const workersFor = (provider: ProviderId) => {
    const configured = spec.concurrency?.perProvider?.[provider];
    return Math.max(1, Math.min(configured ?? 2, globalLimit));
  };

  const providerTasks = [...byProvider.entries()].map(async ([provider, queue]) => {
    let cursor = 0;
    const take = () => (cursor < queue.length ? queue[cursor++] : undefined);

    const worker = async () => {
      for (let run = take(); run; run = take()) {
        if (signal?.aborted) return;
        try {
          const record = await executeOne(run);
          await store.append(record);
          if (record.error) progress.failed += 1;
          else {
            progress.completed += 1;
            if (record.parseStatus !== "ok") progress.invalid += 1;
          }
          onRecord?.(record);
          emit();
        } catch (error) {
          if (signal?.aborted) return;
          progress.failed += 1;
          progress.message = error instanceof Error ? error.message : String(error);
          emit();
        }
      }
    };

    await Promise.all(Array.from({ length: workersFor(provider) }, worker));
  });

  await Promise.all(providerTasks);

  progress.state = signal?.aborted ? "paused" : "done";
  emit();
  return progress;
}
