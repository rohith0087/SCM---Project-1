import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import type { RunStore } from "./store.js";
import { resultsCsv, conditionsCsv, completionCsv } from "./export.js";
import { buildConditions } from "./design.js";
import { sha256 } from "./assets.js";
export async function batchPackage(store: RunStore) {
  const { spec } = store.manifest;
  const records = await store.readAll();
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(store.manifest, null, 2)),
    "study-spec.json": strToU8(JSON.stringify(spec, null, 2)),
    "conditions.json": strToU8(JSON.stringify(buildConditions(spec), null, 2)),
    "results.csv": strToU8(resultsCsv(spec, records)),
    "conditions.csv": strToU8(conditionsCsv(spec)),
    "completion.csv": strToU8(completionCsv(spec, records)),
    "README.txt": strToU8("Research pipeline batch archive\nMode: " + store.manifest.mode + "\nOriginal attachments are named by asset ID; names, SHA-256 hashes, reviewed text, roles, and selectors are in manifest.json.\nReference attachments were not sent to models. Text stimuli were appended as reviewed text; image stimuli were sent as native image content.\nResults CSV contains the latest result per planned call. runs.ndjson retains earlier result attempts. attempts.ndjson counts every reserved provider request, including interrupted requests with no result.\nPossible refusals are heuristic flags. No response is automatically excluded from exports.\nNo API keys are included. Preserve this entire archive with your study records.\n"),
  };
  for (const name of ["runs.ndjson", "attempts.ndjson", "state.json"]) if (existsSync(path.join(store.dir, name))) files[name] = await readFile(path.join(store.dir, name));
  for (const asset of spec.attachments ?? []) {
    const bytes = await readFile(path.join(store.dir, "attachments", asset.id));
    if (sha256(bytes) !== asset.sha256) throw new Error("Attachment archive integrity check failed");
    files[`attachments/${asset.id}`] = bytes;
  }
  return zipSync(files, { level: 1 });
}
