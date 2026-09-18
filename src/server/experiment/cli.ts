import { listExperiments, getExperiment } from "../../experiments/index.js";
import type { ExperimentSpec, PlannedRun } from "../../shared/experiment.js";
import { buildConditions, planRuns, summarise } from "./design.js";
import { writeExports, completionRows } from "./export.js";
import { runExperiment } from "./runner.js";
import { RunStore } from "./store.js";

/**
 * Command line entry point for experiments.
 *
 * Batches run for hours and cost real money, so they belong on the command
 * line where they can be inspected, resumed and logged, rather than behind a
 * browser tab that might be closed halfway through.
 */

try {
  process.loadEnvFile?.(".env");
} catch {
  // Environment may be supplied by the shell instead.
}

const args = process.argv.slice(2);
const [command, target] = args;

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  return undefined;
}

function usage(): void {
  console.log(`
Usage: npm run experiment -- <command> <experiment-id> [options]

Commands:
  list                 Show the experiments defined in this project
  plan <id>            Expand the design and report what would run
  preview <id>         Print fully rendered prompts for the first conditions
  run <id>             Execute the batch, resuming anything already on disk
  status <id>          Show how much of a batch is finished
  export <id>          Write results, codebook and completion CSVs

Options for run:
  --replicates=N       Override replicates, e.g. --replicates=1 for a pilot
  --models=a,b         Only these model lane ids
  --limit=N            Stop after N calls
  --retry-failed       Also retry runs whose last attempt errored
  --dry-run            Show what would be called, call nothing

Options for plan:
  --show-conditions    List every condition id
`);
}

function requireSpec(id: string | undefined): ExperimentSpec {
  if (!id) {
    console.error("An experiment id is required. Run `list` to see them.");
    process.exit(1);
  }
  const spec = getExperiment(id);
  if (!spec) {
    console.error(`Unknown experiment "${id}". Run \`list\` to see them.`);
    process.exit(1);
  }
  return spec;
}

/** Applies pilot overrides without mutating the declared design. */
function applyOverrides(spec: ExperimentSpec): ExperimentSpec {
  const replicates = option("replicates");
  const models = option("models");
  let next = spec;

  if (replicates) {
    const value = Number(replicates);
    if (!Number.isInteger(value) || value < 1) {
      console.error("--replicates must be a positive whole number.");
      process.exit(1);
    }
    next = { ...next, replicates: value };
  }

  if (models) {
    const wanted = new Set(models.split(",").map((entry) => entry.trim()).filter(Boolean));
    const kept = next.models.filter((model) => wanted.has(model.id));
    const unknown = [...wanted].filter((id) => !next.models.some((model) => model.id === id));
    if (unknown.length) {
      console.error(`Unknown model lane ids: ${unknown.join(", ")}`);
      process.exit(1);
    }
    if (!kept.length) {
      console.error("--models selected no lanes.");
      process.exit(1);
    }
    next = { ...next, models: kept };
  }

  return next;
}

function estimateTokens(spec: ExperimentSpec, runs: PlannedRun[]) {
  // Four characters per token is the usual rough rule and is good enough to
  // decide whether a batch is affordable. Output is bounded by max tokens.
  const input = runs.reduce(
    (total, run) => total + Math.ceil((run.systemPrompt.length + run.userPrompt.length) / 4),
    0,
  );
  const outputCeiling = runs.reduce((total, run) => total + (run.parameters.maxTokens ?? 1024), 0);
  return { input, outputCeiling };
}

function commandList(): void {
  const specs = listExperiments();
  if (!specs.length) {
    console.log("No experiments are defined.");
    return;
  }
  for (const spec of specs) {
    const summary = summarise(spec);
    console.log(`${spec.id}  (v${spec.version})`);
    console.log(`  ${spec.title}`);
    console.log(
      `  ${summary.totalRuns} runs = ${summary.conditions} conditions x ${summary.models} models x ${summary.replicates} replicates`,
    );
  }
}

function commandPlan(spec: ExperimentSpec): void {
  const summary = summarise(spec);
  const runs = planRuns(spec);
  const tokens = estimateTokens(spec, runs);

  console.log(spec.title);
  console.log(`id ${spec.id}   version ${spec.version}   seed ${spec.seed ?? 1}`);
  console.log("");
  console.log("Design");
  for (const factor of summary.factors) {
    console.log(`  ${factor.label.padEnd(28)} ${factor.levels} levels`);
  }
  console.log(`  ${"Models".padEnd(28)} ${summary.models}`);
  console.log(`  ${"Replicates per cell".padEnd(28)} ${summary.replicates}`);
  console.log("");
  console.log(`Conditions      ${summary.conditions}`);
  console.log(`Runs per model  ${summary.runsPerModel}`);
  console.log(`Total runs      ${summary.totalRuns}`);
  console.log("");
  console.log("Model lanes");
  for (const model of spec.models) {
    const count = runs.filter((run) => run.modelId === model.id).length;
    console.log(`  ${model.id.padEnd(12)} ${`${model.provider}/${model.model}`.padEnd(32)} ${count} runs`);
  }
  console.log("");
  console.log("Rough token budget");
  console.log(`  input          ~${tokens.input.toLocaleString()}`);
  console.log(`  output ceiling ~${tokens.outputCeiling.toLocaleString()}`);
  console.log("  Apply your own per-token rates; actual output is usually far below the ceiling.");

  if (summary.warnings.length) {
    console.log("");
    console.log("Warnings");
    for (const warning of summary.warnings) console.log(`  - ${warning}`);
  }

  console.log("");
  console.log("First eight runs in execution order");
  for (const run of runs.slice(0, 8)) {
    console.log(`  ${String(run.order).padStart(4)}  ${run.modelId.padEnd(10)} ${run.conditionId}  rep ${run.replicate}`);
  }

  if (flag("show-conditions")) {
    console.log("");
    console.log("Conditions");
    for (const condition of buildConditions(spec)) console.log(`  ${condition.id}`);
  }
}

function commandPreview(spec: ExperimentSpec): void {
  const conditions = buildConditions(spec);
  console.log(`${conditions.length} conditions. Showing the first two in full.\n`);
  for (const condition of conditions.slice(0, 2)) {
    console.log("=".repeat(76));
    console.log(condition.id);
    console.log("=".repeat(76));
    console.log("--- SYSTEM ---");
    console.log(condition.systemPrompt);
    console.log("");
    console.log("--- USER ---");
    console.log(condition.userPrompt);
    console.log("");
  }
}

async function commandRun(spec: ExperimentSpec): Promise<void> {
  const allRuns = planRuns(spec);
  const store = await RunStore.open(spec, allRuns.length);
  const retryFailed = flag("retry-failed");
  const limit = option("limit") ? Number(option("limit")) : undefined;

  let pending = allRuns.filter((run) => {
    if (!store.has(run.runKey)) return true;
    return retryFailed && store.failedKeys().has(run.runKey);
  });

  const alreadyDone = allRuns.length - pending.length;
  if (limit && Number.isFinite(limit)) pending = pending.slice(0, limit);

  console.log(spec.title);
  console.log(`Data directory  ${store.dir}`);
  console.log(`Planned         ${allRuns.length}`);
  console.log(`Already on disk ${alreadyDone}`);
  console.log(`To run now      ${pending.length}`);
  console.log("");

  if (!pending.length) {
    console.log("Nothing to do. Use --retry-failed to reattempt errored runs.");
    return;
  }

  if (flag("dry-run")) {
    console.log("Dry run. First twenty calls that would be made:");
    for (const run of pending.slice(0, 20)) {
      console.log(`  ${String(run.order).padStart(4)}  ${run.modelId.padEnd(10)} ${run.conditionId}  rep ${run.replicate}`);
    }
    return;
  }

  const controller = new AbortController();
  let stopping = false;
  const onSignal = () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\nStopping after in-flight calls finish. Press Ctrl+C again to abandon them.");
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const began = Date.now();
  let lastPrint = 0;

  const result = await runExperiment({
    spec,
    store,
    runs: pending,
    signal: controller.signal,
    onRecord: (record) => {
      if (record.error) {
        console.log(`  ! ${record.modelId} ${record.conditionId} rep ${record.replicate}: ${record.error.slice(0, 140)}`);
      } else if (record.parseStatus !== "ok") {
        console.log(`  ? ${record.modelId} ${record.conditionId} rep ${record.replicate}: ${record.parseStatus} ${record.parseNotes ?? ""}`.trimEnd());
      }
    },
    onProgress: (progress) => {
      const now = Date.now();
      if (now - lastPrint < 1000 && progress.remaining > 0) return;
      lastPrint = now;
      const done = progress.completed + progress.failed;
      const elapsed = (now - began) / 1000;
      const rate = done / Math.max(elapsed, 0.001);
      const eta = rate > 0 ? Math.round(progress.remaining / rate) : 0;
      console.log(
        `  ${done}/${progress.total}  ok ${progress.completed - progress.invalid}  flagged ${progress.invalid}  failed ${progress.failed}  ${rate.toFixed(2)}/s  eta ${eta}s`,
      );
    },
  });

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  console.log("");
  console.log(result.state === "paused" ? "Paused. Run the same command again to resume." : "Batch finished.");
  console.log(`Completed ${result.completed}, flagged ${result.invalid}, failed ${result.failed}.`);
  console.log(`Results appended to ${store.runsFile}`);
}

async function commandStatus(spec: ExperimentSpec): Promise<void> {
  const allRuns = planRuns(spec);
  const store = await RunStore.open(spec, allRuns.length);
  const records = await store.readAll();
  const rows = completionRows(spec, records);

  const totals = rows.reduce(
    (acc, row) => ({
      expected: acc.expected + row.expected,
      ok: acc.ok + row.ok,
      partial: acc.partial + row.partial,
      invalid: acc.invalid + row.invalid,
      missing: acc.missing + row.missing,
      failed: acc.failed + row.failed,
    }),
    { expected: 0, ok: 0, partial: 0, invalid: 0, missing: 0, failed: 0 },
  );

  console.log(spec.title);
  console.log(`Records on disk ${records.length}`);
  console.log("");
  console.log(`Expected  ${totals.expected}`);
  console.log(`Clean     ${totals.ok}`);
  console.log(`Flagged   ${totals.partial}`);
  console.log(`Unusable  ${totals.invalid + totals.missing}`);
  console.log(`Errored   ${totals.failed}`);
  console.log("");

  console.log("By model lane");
  for (const model of spec.models) {
    const lane = rows.filter((row) => row.modelId === model.id);
    const ok = lane.reduce((total, row) => total + row.ok, 0);
    const expected = lane.reduce((total, row) => total + row.expected, 0);
    const failed = lane.reduce((total, row) => total + row.failed, 0);
    console.log(`  ${model.id.padEnd(12)} ${ok}/${expected} clean, ${failed} errored`);
  }

  const gaps = rows.filter((row) => row.ok + row.partial < row.expected);
  if (gaps.length) {
    console.log("");
    console.log(`${gaps.length} cells are short of ${spec.replicates} usable runs. First ten:`);
    for (const row of gaps.slice(0, 10)) {
      console.log(`  ${row.modelId.padEnd(10)} ${row.conditionId}  usable ${row.ok + row.partial}/${row.expected}`);
    }
  }
}

async function commandExport(spec: ExperimentSpec): Promise<void> {
  const allRuns = planRuns(spec);
  const store = await RunStore.open(spec, allRuns.length);
  const records = await store.readAll();

  if (!records.length) {
    console.log("No results on disk yet.");
    return;
  }

  const result = await writeExports(spec, records, store.dir);
  console.log(`Exported ${records.length} runs.`);
  for (const file of result.files) console.log(`  ${file}`);
}

async function main(): Promise<void> {
  switch (command) {
    case "list":
      commandList();
      break;
    case "plan":
      commandPlan(applyOverrides(requireSpec(target)));
      break;
    case "preview":
      commandPreview(applyOverrides(requireSpec(target)));
      break;
    case "run":
      await commandRun(applyOverrides(requireSpec(target)));
      break;
    case "status":
      await commandStatus(applyOverrides(requireSpec(target)));
      break;
    case "export":
      await commandExport(applyOverrides(requireSpec(target)));
      break;
    default:
      usage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
