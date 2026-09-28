import { writeFile } from "node:fs/promises";
import { getExperiment, listExperiments } from "../../experiments/index.js";
import { humanMaterials } from "../../experiments/materials.js";
import { isDemoMode } from "../catalog.js";
import { buildConditions } from "./design.js";
import { writeExports } from "./export.js";
import { BatchService, estimate } from "./service.js";
import { RunStore } from "./store.js";
import { readRevision } from "./projects.js";

try { process.loadEnvFile?.(".env"); } catch { /* Optional environment file. */ }
const args = process.argv.slice(2);
const [command, target] = args;
const flag = (name: string) => args.includes(`--${name}`);
function option(name: string) {
  const inline = args.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 && !args[index + 1]?.startsWith("--") ? args[index + 1] : undefined;
}
async function specFor(id?: string) {
  if (option("project")) {
    if (!option("revision")) throw new Error("Supply the saved --revision ID with --project");
    if (["replicates", "models"].some(name => option(name))) throw new Error("Saved revisions are immutable. Save a new revision to change models or repetitions.");
    return (await readRevision(option("project")!, option("revision")!)).spec;
  }
  const declared = getExperiment(id ?? "");
  if (!declared) throw new Error("Unknown experiment. Use list to see available studies.");
  const spec = structuredClone(declared);
  if (option("replicates")) spec.replicates = Number(option("replicates"));
  if (!Number.isInteger(spec.replicates) || spec.replicates < 1 || spec.replicates > 30) throw new Error("Replicates must be 1–30");
  if (option("models")) {
    const wanted = option("models")!.split(",");
    if (wanted.some(id => !spec.models.some(m => m.id === id))) throw new Error("Unknown model lane");
    spec.models = spec.models.filter(m => wanted.includes(m.id));
  }
  return spec;
}
async function main() {
  if (command === "list") {
    for (const spec of listExperiments()) console.log(spec.id, JSON.stringify(estimate(spec), null, 2));
    return;
  }
  if (command === "plan" || command === "preview") {
    const spec = await specFor(target);
    console.log(JSON.stringify(command === "plan" ? estimate(spec) : buildConditions(spec), null, 2));
    return;
  }
  if (command === "materials") {
    const output = option("out");
    if (!output) throw new Error("Supply --out=<filename.json>");
    await writeFile(output, JSON.stringify(humanMaterials(), null, 2));
    console.log(`Saved shared human-study materials to ${output}`); return;
  }
  if (command === "batches") { console.log(JSON.stringify(await RunStore.list(), null, 2)); return; }
  if (command === "run" || command === "resume") {
    const batchId = command === "resume" ? target : option("batch");
    if (batchId && ["models", "replicates", "mode"].some(name => option(name))) throw new Error("Resume uses the frozen batch settings; create a new batch to change them.");
    if (flag("dry-run")) {
      const spec = batchId ? (await RunStore.openBatch(batchId)).manifest.spec : await specFor(target);
      console.log(JSON.stringify(estimate(spec), null, 2)); return;
    }
    let store: RunStore;
    if (batchId) store = await RunStore.openBatch(batchId);
    else {
      const mode = option("mode") ?? (isDemoMode() ? "demo" : "live");
      if (mode !== "demo" && mode !== "live") throw new Error("Mode must be demo or live");
      store = await RunStore.create(await specFor(target), mode);
    }
    console.log(`Batch ${store.manifest.batchId} (${store.manifest.mode}); ${store.manifest.plannedRuns} planned calls`);
    const service = new BatchService();
    await service.start(store.manifest.batchId, flag("confirm-live"), flag("retry-failed"));
    const pause = () => { service.pause(store.manifest.batchId); console.log("Pausing after in-flight calls are saved..."); };
    process.once("SIGINT", pause);
    process.once("SIGTERM", pause);
    try { await service.wait(store.manifest.batchId); }
    finally { process.off("SIGINT", pause); process.off("SIGTERM", pause); }
    const view = await service.view(store.manifest.batchId);
    console.log(`${view.state}: ${view.valid} valid, ${view.flagged} flagged, ${view.failed} errors of ${view.manifest.plannedRuns}`);
    if (view.error) throw new Error(view.error);
    return;
  }
  if (command === "status" || command === "export") {
    if (!target) throw new Error("Provide a batch ID");
    if (command === "status") console.log(JSON.stringify(await new BatchService().view(target), null, 2));
    else {
      const store = await RunStore.openBatch(target);
      console.log(await writeExports(store.manifest.spec, await store.readAll(), store.dir));
    }
    return;
  }
  console.log(`Experiment commands:
  list
  plan <study-id> [--replicates=1] [--models=openai]
  preview <study-id>
  materials --out=study1-materials.json
  run <study-id> [--replicates=1] [--models=openai] [--mode=demo] [--dry-run]
  run --project=<project-id> --revision=<revision-id> --mode=demo [--dry-run]
  resume <batch-id> [--retry-failed] [--confirm-live]
  batches
  status <batch-id>
  export <batch-id>
Every run creates a NEW batch. Resume uses its frozen configuration.
Live starts require --confirm-live and a server environment with demo mode off.
Invalid/refused responses are retained and never automatically replaced.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
