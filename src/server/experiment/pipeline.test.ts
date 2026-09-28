import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import study from "../../experiments/study2-driver-bias.js";
import { humanMaterials, RATINGS, HEADER, REPORTS, COMPLAINTS } from "../../experiments/materials.js";
import { buildConditions, planRuns } from "./design.js";
import { RunStore } from "./store.js";
import { BatchService } from "./service.js";
import { completionCsv, completionRows, conditionsCsv, resultsCsv } from "./export.js";
import { parseMeasures } from "./parse.js";

function pilot() { return { ...structuredClone(study), replicates: 1, models: [study.models[0]] }; }
async function temporary<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scm-pipeline-test-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
test("revised design has 48 unique cells and 1,440 calls per model", () => {
  const conditions = buildConditions(study);
  assert.equal(conditions.length, 48);
  assert.equal(new Set(conditions.map(c => c.id)).size, 48);
  const runs = planRuns(study);
  assert.equal(runs.length, 5760);
  for (const model of study.models) assert.equal(runs.filter(r => r.modelId === model.id).length, 1440);
  assert.deepEqual(planRuns(study), runs);
  assert.notDeepEqual(planRuns({ ...study, seed: 1 }).map(r => r.runKey), runs.map(r => r.runKey));
});
test("human and LLM conditions share exact complaint/report pairs and the Study 2 six-rating template", () => {
  const human = humanMaterials();
  assert.equal(human.conditions.length, 12);
  for (const condition of buildConditions(study)) {
    const match = human.conditions.find(h => h.identity === condition.cells.identity && h.behavior === condition.cells.behavior && h.escalation === condition.cells.escalation)!;
    assert.ok(match);
    assert.ok(condition.userPrompt.startsWith("CUSTOMER COMPLAINT:"));
    assert.ok(!condition.userPrompt.includes(HEADER));
    assert.ok(!condition.userPrompt.includes("operational_risk"));
    assert.ok(condition.userPrompt.includes(match.report));
    assert.ok(condition.userPrompt.includes(match.complaint));
    assert.equal(match.report, REPORTS[match.escalation][match.behavior]);
    assert.equal(match.complaint, COMPLAINTS[match.escalation]);
    assert.ok(!condition.userPrompt.includes("{{"));
    assert.ok(!condition.userPrompt.includes("attention check"));
    if (match.behavior === "compliant") assert.ok(match.report.includes("didn't record anything"));
    for (const rating of RATINGS.filter(r => r.id !== "operational_risk")) assert.ok(condition.userPrompt.includes(`"${rating.id}": [1-7]`));
  }
  assert.equal(study.measures.filter(m => m.type === "integer").length, 6);
});
test("missing report mapping fails before collection", () => {
  assert.throws(() => buildConditions({ ...study, stimulusRules: [] }), /Unresolved stimulus/);
});
test("full demo pilot yields six valid ratings plus reasoning, reproducible exports, and immutable settings", async () => temporary(async root => {
  const store = await RunStore.create(pilot(), "demo", root);
  const before = await readFile(store.manifestFile, "utf8");
  const service = new BatchService(root);
  await service.start(store.manifest.batchId);
  await service.wait(store.manifest.batchId);
  const view = await service.view(store.manifest.batchId);
  assert.equal(view.state, "done");
  assert.equal(view.valid, 48);
  assert.equal(view.failed, 0);
  assert.equal(view.flagged, 0);
  const persisted = await RunStore.openBatch(store.manifest.batchId, root);
  const records = await persisted.readAll();
  for (const record of records) {
    assert.equal(record.mode, "demo");
    assert.equal(record.reportedModel, "synthetic-fixture");
    assert.equal(record.batchId, store.manifest.batchId);
    assert.equal(parseMeasures(record.rawText, study.measures).status, "ok");
  }
  const csv = resultsCsv(pilot(), records);
  assert.ok(!csv.includes('"operational_risk"'));
  assert.ok(csv.includes('"reasoning"'));
  assert.ok(csv.includes('"batch_id","mode"'));
  assert.equal(completionRows(pilot(), records).filter(r => r.ok === 1).length, 48);
  assert.ok(conditionsCsv(pilot()).includes("Taylor Reeves"));
  await service.start(store.manifest.batchId);
  await service.wait(store.manifest.batchId);
  assert.equal((await (await RunStore.openBatch(store.manifest.batchId, root)).readAll()).length, 48);
  assert.equal(await readFile(store.manifestFile, "utf8"), before);
  assert.equal(resultsCsv(pilot(), await persisted.readAll()), csv);
}));
test("pause saves in-flight responses and resume fills exactly the remaining cells", async () => temporary(async root => {
  const store = await RunStore.create(pilot(), "demo", root);
  const service = new BatchService(root);
  await service.start(store.manifest.batchId);
  await new Promise(resolve => setTimeout(resolve, 140));
  service.pause(store.manifest.batchId);
  await service.wait(store.manifest.batchId);
  const paused = await service.view(store.manifest.batchId);
  assert.equal(paused.state, "paused");
  assert.ok(paused.completed > 0 && paused.completed < 48);
  const first = await (await RunStore.openBatch(store.manifest.batchId, root)).readAll();
  await service.start(store.manifest.batchId);
  await service.wait(store.manifest.batchId);
  const final = await (await RunStore.openBatch(store.manifest.batchId, root)).readAll();
  assert.equal(final.length, 48);
  for (const record of first) assert.deepEqual(final.find(r => r.runKey === record.runKey), record);
}));
test("batches isolate pilot/full, demo/live, model changes and reject altered snapshots", async () => temporary(async root => {
  const one = await RunStore.create(pilot(), "demo", root);
  const two = await RunStore.create(pilot(), "live", root);
  const changed = pilot(); changed.models = [{ ...changed.models[0], model: "other-version" }];
  const three = await RunStore.create(changed, "demo", root);
  assert.notEqual(one.manifest.batchId, two.manifest.batchId);
  assert.notEqual(one.manifest.fingerprint, two.manifest.fingerprint);
  assert.notEqual(one.manifest.fingerprint, three.manifest.fingerprint);
  const release = await one.lock();
  await assert.rejects(() => one.lock(), /already running/);
  await release();
  const altered = structuredClone(one.manifest); altered.spec.userPromptTemplate += "changed";
  await writeFile(one.manifestFile, JSON.stringify(altered));
  await assert.rejects(() => RunStore.openBatch(one.manifest.batchId, root), /altered/);
  await assert.rejects(() => RunStore.openBatch("../escape", root), /Invalid batch/);
  await assert.rejects(() => new BatchService(root).start(two.manifest.batchId), /Confirm/);
}));
test("out-of-range responses are retained but do not count as usable", async () => temporary(async root => {
  const spec = pilot();
  const store = await RunStore.create(spec, "demo", root);
  const service = new BatchService(root);
  await service.start(store.manifest.batchId); await service.wait(store.manifest.batchId);
  const records = await (await RunStore.openBatch(store.manifest.batchId, root)).readAll();
  const first = records[0];
  const values = JSON.parse(first.rawText); values.performance_rating = 9;
  const parsed = parseMeasures(JSON.stringify(values), spec.measures);
  assert.equal(parsed.status, "partial");
  first.parseStatus = parsed.status; first.parsed = parsed.values;
  const row = completionRows(spec, records).find(r => r.conditionId === first.conditionId)!;
  assert.equal(row.ok, 0); assert.equal(row.partial, 1);
  assert.ok(completionCsv(spec, [first]).includes('"0.0"'));
}));
