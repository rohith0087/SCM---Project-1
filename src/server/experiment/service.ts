import type { ExperimentSpec, ExperimentProgress } from "../../shared/experiment.js";
import { isDemoMode, providerConfigured } from "../catalog.js";
import { planRuns, summarise } from "./design.js";
import { completionRows } from "./export.js";
import { RunStore, DATA_ROOT } from "./store.js";
import { runExperiment } from "./runner.js";
import { effectiveParameters } from "../providers/base.js";

export function assertLiveReady(spec: ExperimentSpec, confirmed: boolean) {
  if (!confirmed) throw new Error("Confirm the reviewed model selection and API spend before starting a live batch.");
  if (isDemoMode()) throw new Error("The server is in demo mode. Configure provider keys and disable demo mode before live collection.");
  for (const model of spec.models) {
    if (!providerConfigured(model.provider)) throw new Error(`No API key configured for ${model.provider}`);
  }
}
export function estimate(spec: ExperimentSpec) {
  const runs = planRuns(spec);
  return {
    ...summarise(spec),
    models: spec.models.map(model => {
      const calls = runs.filter(r => r.modelId === model.id);
      return { id: model.id, calls: calls.length,
        requestedParameters: model.parameters ?? {}, effectiveParameters: effectiveParameters({ ...model, parameters: model.parameters ?? {}, enabled: true }),
        imageCalls: calls.filter(r => r.imageIds?.length).length,
        inputTokens: calls.reduce((n, r) => n + Math.ceil((r.systemPrompt.length + r.userPrompt.length) / 4), 0),
        outputTokens: calls.reduce((n, r) => n + (r.parameters.maxTokens ?? 2048), 0),
      };
    }),
  };
}
type Job = { controller: AbortController; progress?: ExperimentProgress; done: Promise<void>; store: RunStore; stopping: boolean };
export class BatchService {
  private jobs = new Map<string, Job>();
  private errors = new Map<string, string>();
  constructor(readonly root = DATA_ROOT) {}
  async view(id: string) {
    const job = this.jobs.get(id);
    const store = job?.store ?? await RunStore.openBatch(id, this.root);
    const records = await store.readAll();
    const rows = completionRows(store.manifest.spec, records);
    const saved = await store.readState();
    const error = this.errors.get(id) ?? (saved.state === "error" ? saved.error : undefined);
    const state = job ? (job.stopping ? "pausing" : "running") : error ? "error" : records.length >= store.manifest.plannedRuns ? "done" : records.length ? "paused" : "ready";
    return { manifest: store.manifest, state, error, progress: job?.progress, rows, attempts: store.attempts,
      completed: records.length, valid: records.filter(r => !r.error && r.parseStatus === "ok").length,
      failed: records.filter(r => r.error).length,
      flagged: records.filter(r => !r.error && r.parseStatus !== "ok").length,
      recent: records.slice(-20),
    };
  }
  async start(id: string, confirmed = false, retryFailed = false) {
    if (this.jobs.has(id)) throw new Error("This batch is already running");
    const initial = await RunStore.openBatch(id, this.root);
    if (initial.manifest.mode === "live") assertLiveReady(initial.manifest.spec, confirmed);
    const unlock = await initial.lock();
    let store: RunStore;
    try { store = await RunStore.openBatch(id, this.root); } catch (error) { await unlock(); throw error; }
    const controller = new AbortController();
    const runs = planRuns(store.manifest.spec).filter(r => !store.has(r.runKey) || (retryFailed && store.failedKeys().has(r.runKey)));
    const job: Job = { controller, done: Promise.resolve(), store, stopping: false };
    this.errors.delete(id);
    this.jobs.set(id, job);
    job.done = (async () => {
      try {
        await store.writeState("running");
        const progress = await runExperiment({ spec: store.manifest.spec, store, runs, signal: controller.signal,
          onProgress: progress => { job.progress = progress; } });
        await store.writeState(progress.state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.errors.set(id, message);
        try { await store.writeState("error", message); } catch { this.errors.set(id, `${message} (Could not persist batch status.)`); }
      }
      finally {
        try { await unlock(); } catch { this.errors.set(id, "Could not release batch lock. Inspect storage before resuming."); }
        this.jobs.delete(id);
      }
    })();
    return this.view(id);
  }
  pause(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("This batch is not running in this server");
    job.stopping = true;
    job.controller.abort();
  }
  async wait(id: string) { await this.jobs.get(id)?.done; }
  async records(id: string) { return (this.jobs.get(id)?.store ?? await RunStore.openBatch(id, this.root)).readAll(); }
  async shutdown() {
    for (const job of this.jobs.values()) { job.stopping = true; job.controller.abort(); }
    await Promise.all([...this.jobs.values()].map(j => j.done));
  }
}
