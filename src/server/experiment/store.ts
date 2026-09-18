import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ExperimentSpec, RunRecord } from "../../shared/experiment.js";

/**
 * Append-only storage for experiment results.
 *
 * Every completed call is flushed to disk immediately, one JSON object per
 * line. A batch of two thousand calls takes hours and will be interrupted, so
 * the only safe design is one where nothing is held in memory waiting to be
 * saved and a resumed run can tell exactly what already exists.
 *
 * Browser localStorage cannot hold this volume, which is why results live on
 * the server rather than in the comparison UI.
 */

export const DATA_ROOT = path.resolve(process.cwd(), "data");

export interface Manifest {
  experimentId: string;
  experimentVersion: string;
  title: string;
  seed: number;
  replicates: number;
  plannedRuns: number;
  createdAt: string;
  updatedAt: string;
  /** Full spec snapshot, so results stay interpretable if the spec changes. */
  spec: ExperimentSpec;
}

/** Serialises appends so concurrent workers cannot interleave partial lines. */
class AppendQueue {
  private tail: Promise<void> = Promise.resolve();

  push(task: () => Promise<void>): Promise<void> {
    this.tail = this.tail.then(task, task);
    return this.tail;
  }
}

export class RunStore {
  private readonly queue = new AppendQueue();
  private readonly keys = new Set<string>();
  private readonly failed = new Set<string>();

  private constructor(
    readonly dir: string,
    readonly runsFile: string,
    readonly manifestFile: string,
  ) {}

  static async open(spec: ExperimentSpec, plannedRuns: number, root = DATA_ROOT): Promise<RunStore> {
    const dir = path.join(root, spec.id);
    await mkdir(dir, { recursive: true });

    const store = new RunStore(dir, path.join(dir, "runs.ndjson"), path.join(dir, "manifest.json"));
    await store.loadExisting();

    const now = new Date().toISOString();
    const manifest: Manifest = {
      experimentId: spec.id,
      experimentVersion: spec.version,
      title: spec.title,
      seed: spec.seed ?? 1,
      replicates: spec.replicates,
      plannedRuns,
      createdAt: existsSync(store.manifestFile)
        ? ((await store.readManifest())?.createdAt ?? now)
        : now,
      updatedAt: now,
      spec,
    };
    await writeFile(store.manifestFile, JSON.stringify(manifest, null, 2), "utf8");

    return store;
  }

  private async loadExisting(): Promise<void> {
    if (!existsSync(this.runsFile)) return;
    const contents = await readFile(this.runsFile, "utf8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as RunRecord;
        if (!record.runKey) continue;
        this.keys.add(record.runKey);
        if (record.error) this.failed.add(record.runKey);
        else this.failed.delete(record.runKey);
      } catch {
        // A torn final line from a hard kill. Skip it and carry on.
      }
    }
  }

  async readManifest(): Promise<Manifest | undefined> {
    if (!existsSync(this.manifestFile)) return undefined;
    try {
      return JSON.parse(await readFile(this.manifestFile, "utf8")) as Manifest;
    } catch {
      return undefined;
    }
  }

  /** Run keys already on disk, whether they succeeded or failed. */
  completedKeys(): ReadonlySet<string> {
    return this.keys;
  }

  /** Run keys whose last recorded attempt ended in a transport or API error. */
  failedKeys(): ReadonlySet<string> {
    return this.failed;
  }

  has(runKey: string): boolean {
    return this.keys.has(runKey);
  }

  async append(record: RunRecord): Promise<void> {
    await this.queue.push(async () => {
      await appendFile(this.runsFile, `${JSON.stringify(record)}\n`, "utf8");
      this.keys.add(record.runKey);
      if (record.error) this.failed.add(record.runKey);
      else this.failed.delete(record.runKey);
    });
  }

  async readAll(): Promise<RunRecord[]> {
    if (!existsSync(this.runsFile)) return [];
    const contents = await readFile(this.runsFile, "utf8");
    const records: RunRecord[] = [];
    const byKey = new Map<string, RunRecord>();

    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as RunRecord;
        // A retried run appears twice; the last write is the one that counts.
        byKey.set(record.runKey, record);
      } catch {
        // Skip an unreadable line rather than failing the whole export.
      }
    }

    for (const record of byKey.values()) records.push(record);
    records.sort((a, b) => a.order - b.order);
    return records;
  }
}
