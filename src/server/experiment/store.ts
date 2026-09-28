import { appendFile, mkdir, readFile, writeFile, readdir, open, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import type { ExperimentSpec, RunRecord } from "../../shared/experiment.js";
import { planRuns, buildConditions } from "./design.js";
import { readAsset, ASSET_ROOT, sha256 } from "./assets.js";

// Legacy data/<experiment-id> is deliberately never resumed by this store.
export const DATA_ROOT = path.resolve(process.cwd(), "data", "batches");
export interface Manifest {
  batchId: string;
  mode: "demo" | "live";
  experimentId: string;
  experimentVersion: string;
  title: string;
  plannedRuns: number;
  createdAt: string;
  fingerprint: string;
  spec: ExperimentSpec;
  conditionsHash?: string;
}
function fingerprint(spec: ExperimentSpec, mode: string) {
  return createHash("sha256").update(JSON.stringify({ spec, mode })).digest("hex");
}
function batchDirectory(root: string, id: string) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error("Invalid batch ID");
  return path.join(root, id);
}
export class RunStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly records = new Map<string, RunRecord>();
  attempts = 0;
  readonly runsFile: string;
  readonly manifestFile: string;
  private constructor(readonly dir: string, readonly manifest: Manifest) {
    this.runsFile = path.join(dir, "runs.ndjson");
    this.manifestFile = path.join(dir, "manifest.json");
  }
  static async create(spec: ExperimentSpec, mode: "demo" | "live", root = DATA_ROOT, assetRoot = ASSET_ROOT) {
    const conditions = buildConditions(spec);
    for (const attachment of spec.attachments ?? []) {
      if (!attachment.reviewed) throw new Error(`Review the attachment before creating a batch: ${attachment.name}`);
      if (attachment.role === "stimulus" && !attachment.mime.startsWith("image/") && !attachment.reviewedText.trim()) throw new Error(`Stimulus has no reviewed text: ${attachment.name}`);
    }
    const snapshot = structuredClone(spec);
    const batchId = randomUUID();
    const dir = batchDirectory(root, batchId);
    await mkdir(dir, { recursive: true });
    const manifest: Manifest = {
      batchId, mode, experimentId: snapshot.id, experimentVersion: snapshot.version,
      title: snapshot.title, createdAt: new Date().toISOString(),
      plannedRuns: planRuns(snapshot).length, fingerprint: fingerprint(snapshot, mode), spec: snapshot,
      conditionsHash: sha256(Buffer.from(JSON.stringify(conditions))),
    };
    for (const attachment of snapshot.attachments ?? []) {
      const { asset, bytes } = await readAsset(attachment.id, assetRoot);
      if (asset.sha256 !== attachment.sha256 || asset.mime !== attachment.mime) throw new Error("Attachment metadata mismatch");
      await mkdir(path.join(dir, "attachments"), { recursive: true });
      await writeFile(path.join(dir, "attachments", attachment.id), bytes, { flag: "wx" });
    }
    await writeFile(path.join(dir, "conditions.json"), JSON.stringify(conditions, null, 2), { flag: "wx" });
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
    return new RunStore(dir, manifest);
  }
  static async openBatch(batchId: string, root = DATA_ROOT) {
    const dir = batchDirectory(root, batchId);
    const manifest: Manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    if (manifest.batchId !== batchId || fingerprint(manifest.spec, manifest.mode) !== manifest.fingerprint) {
      throw new Error("Batch configuration was altered. Create a new batch instead of resuming.");
    }
    const store = new RunStore(dir, manifest);
    if (manifest.conditionsHash && sha256(Buffer.from(JSON.stringify(buildConditions(manifest.spec)))) !== manifest.conditionsHash) throw new Error("The prompt renderer changed. Export this batch and create a new batch before running it.");
    const attemptsFile = path.join(dir, "attempts.ndjson");
    if (existsSync(attemptsFile)) {
      const attempts = (await readFile(attemptsFile, "utf8")).split("\n").filter(Boolean);
      for (const line of attempts) JSON.parse(line);
      store.attempts = attempts.length;
    }
    if (existsSync(store.runsFile)) {
      const contents = await readFile(store.runsFile, "utf8");
      for (const line of contents.split("\n")) {
        if (!line.trim()) continue;
        let record: RunRecord;
        try { record = JSON.parse(line); }
        catch { throw new Error("A result line is corrupt; inspect the batch before resuming."); }
        if (record.batchId !== batchId || record.mode !== manifest.mode) throw new Error("Mixed batch records detected");
        store.records.set(record.runKey, record);
      }
    }
    return store;
  }
  static async list(root = DATA_ROOT): Promise<Manifest[]> {
    if (!existsSync(root)) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const manifests: Manifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(await readFile(path.join(root, entry.name, "manifest.json"), "utf8")) as Manifest;
      manifests.push(manifest);
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  has(key: string) { return this.records.has(key); }
  failedKeys(): ReadonlySet<string> {
    return new Set([...this.records.values()].filter(r => r.error).map(r => r.runKey));
  }
  completedKeys(): ReadonlySet<string> { return new Set(this.records.keys()); }
  async append(record: RunRecord) {
    if (record.batchId !== this.manifest.batchId || record.mode !== this.manifest.mode) throw new Error("Result does not belong to this batch");
    this.tail = this.tail.then(async () => {
      await appendFile(this.runsFile, `${JSON.stringify(record)}\n`, "utf8");
      this.records.set(record.runKey, record);
    });
    await this.tail;
  }
  async readAll() { return [...this.records.values()].sort((a, b) => a.order - b.order); }
  async reserveAttempt(runKey: string) {
    const task = this.tail.then(async () => {
      const limit = this.manifest.spec.limits?.maxTotalCalls;
      if (limit !== undefined && this.attempts >= limit) throw new Error("CALL_LIMIT: This batch reached its total call-attempt limit, including retries. No additional requests were sent.");
      await appendFile(path.join(this.dir, "attempts.ndjson"), JSON.stringify({ runKey, at: new Date().toISOString(), attemptNumber: this.attempts + 1 }) + "\n", "utf8");
      this.attempts += 1;
    });
    this.tail = task.catch(() => {});
    await task;
  }
  async image(id: string) {
    const asset = this.manifest.spec.attachments?.find(a => a.id === id && a.mime.startsWith("image/") && a.role === "stimulus");
    if (!asset) throw new Error("Unknown image attachment");
    const bytes = await readFile(path.join(this.dir, "attachments", asset.id));
    if (sha256(bytes) !== asset.sha256) throw new Error("Image integrity check failed");
    return { name: asset.name, mime: asset.mime as "image/png" | "image/jpeg", base64: bytes.toString("base64") };
  }
  async readState(): Promise<{ state?: string; error?: string }> {
    try { return JSON.parse(await readFile(path.join(this.dir, "state.json"), "utf8")); } catch { return {}; }
  }
  async writeState(state: string, error?: string) {
    const tmp = path.join(this.dir, "state.tmp");
    await writeFile(tmp, JSON.stringify({ state, error, updatedAt: new Date().toISOString() }));
    await (await import("node:fs/promises")).rename(tmp, path.join(this.dir, "state.json"));
  }
  /** Prevent CLI and browser workers from executing the same batch simultaneously. */
  async lock(): Promise<() => Promise<void>> {
    const file = path.join(this.dir, "running.lock");
    try {
      const handle = await open(file, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(file, "utf8"));
      let alive = true;
      try { process.kill(pid, 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== "ESRCH"; }
      if (alive || !pid) throw new Error("This batch is already running in another worker");
      await unlink(file);
      return this.lock();
    }
    return async () => { await unlink(file); };
  }
}
