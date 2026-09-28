import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { StudyRevision } from "../../shared/experiment.js";
import { checkedId, canonicalAttachments } from "./assets.js";
import { validateSpec } from "./schema.js";
export const PROJECT_ROOT = path.resolve("data/projects");
const queues = new Map<string, Promise<unknown>>();
export async function readRevision(projectId: string, revisionId: string, root = PROJECT_ROOT): Promise<StudyRevision> {
  return JSON.parse(await readFile(path.join(root, checkedId(projectId), `${checkedId(revisionId)}.json`), "utf8"));
}
export async function listProjects(root = PROJECT_ROOT) {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return Promise.all(entries.filter(e => e.isDirectory()).map(async e => {
    const head = JSON.parse(await readFile(path.join(root, checkedId(e.name), "head.json"), "utf8"));
    return readRevision(e.name, head.revisionId, root);
  }));
}
export async function revisions(projectId: string, root = PROJECT_ROOT) {
  const entries = await readdir(path.join(root, checkedId(projectId)));
  const all = await Promise.all(entries.filter(n => n.endsWith(".json") && n !== "head.json").map(n => readRevision(projectId, n.slice(0,-5), root)));
  return all.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveRevision(value: unknown, projectId: string = randomUUID(), baseRevision?: string, root = PROJECT_ROOT, assetRoot?: string) {
  checkedId(projectId);
  const previous = queues.get(projectId) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const spec = validateSpec(value); spec.attachments = await canonicalAttachments(spec.attachments, assetRoot);
    const dir = path.join(root, projectId);
    const headPath = path.join(dir, "head.json");
    if (existsSync(headPath)) {
      const head = JSON.parse(await readFile(headPath, "utf8"));
      if (head.revisionId !== baseRevision) throw new Error("This project has a newer revision. Reload it before saving.");
    }
    await mkdir(dir, { recursive: true });
    const revisionId = randomUUID();
    const revision: StudyRevision = { projectId, revisionId, createdAt: new Date().toISOString(), spec: { ...spec, projectId, revisionId } };
    await writeFile(path.join(dir, `${revisionId}.json`), JSON.stringify(revision, null, 2), { flag: "wx" });
    const tmp = path.join(dir, "head.tmp");
    await writeFile(tmp, JSON.stringify({ revisionId })); await rename(tmp, headPath);
    return revision;
  });
  queues.set(projectId, task);
  try { return await task; } finally { if (queues.get(projectId) === task) queues.delete(projectId); }
}
