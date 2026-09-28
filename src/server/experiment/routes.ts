import express, { Router } from "express";
import { z } from "zod";
import { getExperiment, listExperiments } from "../../experiments/index.js";
import { humanMaterials } from "../../experiments/materials.js";
import { isDemoMode } from "../catalog.js";
import { buildConditions } from "./design.js";
import { BatchService, estimate } from "./service.js";
import { RunStore } from "./store.js";
import { resultsCsv, conditionsCsv, completionCsv, toCsv } from "./export.js";
import { validateSpec } from "./schema.js";
import { saveAsset, readAsset, canonicalAttachments } from "./assets.js";
import { listProjects, saveRevision, revisions, readRevision } from "./projects.js";
import { batchPackage } from "./package.js";

export const experimentRouter = Router();
const service = new BatchService();
export const stopExperiments = () => service.shutdown();
const Config = z.object({
  experimentId: z.string(), mode: z.enum(["demo", "live"]).default("demo"),
  replicates: z.number().int().min(1).max(30).default(1),
  seed: z.number().int().min(0).max(4294967295).default(20260918),
  models: z.array(z.object({
    id: z.string().regex(/^[\w-]+$/), provider: z.enum(["openai", "anthropic", "google", "xai"]),
    model: z.string().trim().min(1).max(120),
    parameters: z.object({
      maxTokens: z.number().int().min(128).max(16384).default(2048),
      temperature: z.number().min(0).max(2).optional(), topP: z.number().min(0).max(1).optional(),
      seed: z.number().int().optional(),
      reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
      thinkingLevel: z.enum(["low", "medium", "high"]).optional(),
    }).default({ maxTokens: 2048 }),
  })).min(1).max(8),
});
async function configured(body: unknown) {
  if (body && typeof body === "object" && "spec" in body) {
    const spec = validateSpec(body.spec);
    spec.attachments = await canonicalAttachments(spec.attachments);
    return { mode: z.enum(["demo", "live"]).parse("mode" in body ? body.mode : "demo"), spec };
  }
  const config = Config.parse(body);
  const base = getExperiment(config.experimentId);
  if (!base) throw new Error("Unknown experiment");
  if (new Set(config.models.map(m => m.id)).size !== config.models.length) throw new Error("Model lane IDs must be unique");
  return { mode: config.mode, spec: { ...structuredClone(base), replicates: config.replicates, seed: config.seed, models: config.models } };
}
experimentRouter.get("/experiments", (_req, res) => {
  res.json({ experiments: listExperiments(), demoMode: isDemoMode() });
});
experimentRouter.post("/experiments/preview", async (req, res) => {
  const { spec } = await configured(req.body);
  res.json({ summary: estimate(spec), conditions: buildConditions(spec) });
});
experimentRouter.get("/experiments/materials", (req, res) => {
  const materials = humanMaterials();
  res.setHeader("Content-Disposition", `attachment; filename="study1-materials.${req.query.format === "csv" ? "csv" : "json"}"`);
  if (req.query.format === "csv") {
    res.type("text/csv").send("\uFEFF" + toCsv(["condition_id", "identity", "behavior", "escalation", "header", "driver", "complaint", "report"],
      materials.conditions.map(c => [c.id, c.identity, c.behavior, c.escalation, c.header, c.driver, c.complaint, c.report])));
  } else res.json(materials);
});
experimentRouter.get("/batches", async (_req, res) => { res.json(await RunStore.list()); });
experimentRouter.post("/batches", async (req, res) => {
  const { spec: submitted, mode } = await configured(req.body);
  let spec = submitted;
  if (submitted.projectId || submitted.revisionId) {
    if (!submitted.projectId || !submitted.revisionId || req.body.reviewed !== true) throw new Error("Save and approve a study revision before creating its batch");
    spec = (await readRevision(submitted.projectId, submitted.revisionId)).spec;
    if (JSON.stringify(validateSpec(spec)) !== JSON.stringify(validateSpec(submitted))) throw new Error("Draft differs from saved revision. Save it again before creating the batch.");
  }
  const store = await RunStore.create(spec, mode);
  res.status(201).json(await service.view(store.manifest.batchId));
});
experimentRouter.get("/batches/:id", async (req, res) => { res.json(await service.view(req.params.id)); });
experimentRouter.post("/batches/:id/start", async (req, res) => {
  const input = z.object({ confirmed: z.boolean().default(false), retryFailed: z.boolean().default(false) }).parse(req.body ?? {});
  res.json(await service.start(req.params.id, input.confirmed, input.retryFailed));
});
experimentRouter.post("/batches/:id/pause", (req, res) => {
  service.pause(req.params.id); res.json({ state: "pausing" });
});
experimentRouter.get("/batches/:id/export/:kind", async (req, res) => {
  const store = await RunStore.openBatch(req.params.id);
  const spec = store.manifest.spec;
  const records = await store.readAll();
  const kind = req.params.kind;
  if (kind === "package") {
    const state = await service.view(req.params.id);
    if (["running", "pausing"].includes(state.state)) throw new Error("Pause the batch before downloading its complete archive");
    res.attachment(`${store.manifest.batchId}.zip`).type("application/zip").send(Buffer.from(await batchPackage(store))); return;
  }
  if (kind === "manifest") {
    res.attachment(`${store.manifest.batchId}-manifest.json`).json(store.manifest); return;
  }
  const csv = kind === "results" ? resultsCsv(spec, records) : kind === "conditions" ? conditionsCsv(spec) : kind === "completion" ? completionCsv(spec, records) : undefined;
  if (csv === undefined) { res.status(400).json({ error: "Unknown export" }); return; }
  res.attachment(`${store.manifest.batchId}-${kind}.csv`).type("text/csv").send("\uFEFF" + csv);
});
experimentRouter.get("/projects", async (_req,res) => { res.json(await listProjects()); });
experimentRouter.post("/projects", async (req,res) => { res.status(201).json(await saveRevision(req.body.spec)); });
experimentRouter.get("/projects/:id/revisions", async (req,res) => { res.json(await revisions(req.params.id)); });
experimentRouter.post("/projects/:id/revisions", async (req,res) => {
  res.status(201).json(await saveRevision(req.body.spec, req.params.id, req.body.baseRevision));
});
experimentRouter.post("/assets", express.raw({ type: "application/octet-stream", limit: "10mb" }), async (req,res) => {
  if (!Buffer.isBuffer(req.body)) throw new Error("Upload the original file as application/octet-stream");
  res.status(201).json(await saveAsset(z.string().min(1).max(200).parse(req.query.name), req.body));
});
experimentRouter.get("/assets/:id/original", async (req,res) => {
  const { asset, bytes } = await readAsset(req.params.id);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.query.preview === "true" && asset.mime.startsWith("image/")) res.type(asset.mime).send(bytes);
  else res.attachment(asset.name).type(asset.mime).send(bytes);
});
experimentRouter.get("/batches/:id/records", async (req,res) => {
  const query = z.object({ page: z.coerce.number().int().min(1).default(1), status: z.string().default("all"), model: z.string().default(""), search: z.string().max(200).default("") }).parse(req.query);
  const records = await service.records(req.params.id);
  const selected = records.filter(r => (query.status === "all" || (query.status === "error" ? Boolean(r.error) : !r.error && r.parseStatus === query.status)) && (!query.model || r.modelId === query.model) && (!query.search || `${r.conditionId} ${r.rawText}`.toLowerCase().includes(query.search.toLowerCase())));
  res.json({ total: selected.length, page: query.page, pageSize: 25, records: selected.slice((query.page-1)*25, query.page*25) });
});
experimentRouter.use((error: Error, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  res.status(400).json({ error: error.message });
});
