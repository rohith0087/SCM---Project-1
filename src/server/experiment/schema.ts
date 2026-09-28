import { z } from "zod";
import type { ExperimentSpec } from "../../shared/experiment.js";
import { buildConditions } from "./design.js";
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/).refine(v => !["constructor", "prototype", "__proto__"].includes(v), "Reserved ID");
const text = z.string().max(200000);
const vars = z.record(id, text);
export const ModelSchema = z.object({
  id, provider: z.enum(["openai", "anthropic", "google", "xai"]), model: z.string().trim().min(1).max(120),
  parameters: z.object({
    maxTokens: z.number().int().min(128).max(32768).default(2048),
    temperature: z.number().min(0).max(2).optional(), topP: z.number().min(0).max(1).optional(), seed: z.number().int().optional(),
    reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
    thinkingLevel: z.enum(["low", "medium", "high"]).optional(),
  }).default({ maxTokens: 2048 }),
});
const SpecSchema = z.object({
  id, version: z.string().min(1).max(100), title: z.string().min(1).max(200), notes: text.optional(),
  factors: z.array(z.object({ id, label: z.string().min(1).max(200), levels: z.array(z.object({ id, label: z.string().min(1).max(200), vars: vars.optional(), systemPrompt: text.optional() })).min(1).max(100) })).max(8),
  models: z.array(ModelSchema).min(1).max(8), replicates: z.number().int().min(1).max(1000),
  userPromptTemplate: text.min(1), systemPrompt: text.optional(), seed: z.number().int().min(0).max(4294967295).optional(),
  measures: z.array(z.object({ id, label: z.string().min(1).max(200), type: z.enum(["integer", "number", "text"]), min: z.number().finite().optional(), max: z.number().finite().optional(), required: z.boolean().optional(), allowedValues: z.array(z.string().min(1).max(200)).min(1).max(100).optional() })).max(100),
  responseMode: z.enum(["json", "text"]).default("json"),
  concurrency: z.object({ global: z.number().int().min(1).max(12), perProvider: z.object({ openai: z.number().int().min(1).max(6).optional(), anthropic: z.number().int().min(1).max(6).optional(), google: z.number().int().min(1).max(6).optional(), xai: z.number().int().min(1).max(6).optional() }).optional() }).optional(),
  retry: z.object({ maxAttempts: z.number().int().min(1).max(5), baseDelayMs: z.number().int().min(100).max(30000) }).optional(),
  stimulusRules: z.array(z.object({ when: z.record(id, id), vars })).max(1000).optional(),
  attachments: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200), mime: z.string().max(100), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(), extractedText: text, warnings: z.array(z.string()),
    role: z.enum(["reference", "stimulus"]), reviewedText: text, reviewed: z.boolean(), when: z.record(id, id),
  })).max(20).optional(),
  limits: z.object({ timeoutMs: z.number().int().min(1000).max(600000), maxTotalCalls: z.number().int().min(1).max(100000) }).optional(),
  projectId: z.string().uuid().optional(), revisionId: z.string().uuid().optional(),
});
export function validateSpec(value: unknown): ExperimentSpec {
  const spec = SpecSchema.parse(value);
  for (const [label, items] of [["factors", spec.factors], ["models", spec.models], ["measures", spec.measures], ...spec.factors.map(f => [`levels of ${f.id}`, f.levels])] as Array<[string, Array<{id: string}>]>) {
    if (new Set(items.map(i => i.id)).size !== items.length) throw new Error(`Duplicate IDs in ${label}`);
  }
  const conditions = spec.factors.reduce((n, f) => n * f.levels.length, 1);
  if (conditions > 1000 || conditions * spec.models.length * spec.replicates > 50000) throw new Error("Limit: 1,000 conditions or 50,000 planned calls per batch");
  if (spec.responseMode === "json" && !spec.measures.length) throw new Error("Define response fields for JSON validation, or select raw text");
  for (const measure of spec.measures) {
    if (measure.min !== undefined && measure.max !== undefined && measure.min > measure.max) throw new Error(`Invalid bounds for ${measure.id}`);
    if (measure.type === "integer" && [measure.min, measure.max].some(v => v !== undefined && !Number.isInteger(v))) throw new Error(`Integer bounds required for ${measure.id}`);
    if (measure.type !== "text" && measure.allowedValues) throw new Error(`Categories only apply to text fields: ${measure.id}`);
  }
  for (const selector of [...(spec.stimulusRules ?? []).map(r => r.when), ...(spec.attachments ?? []).map(a => a.when)]) {
    for (const [factor, level] of Object.entries(selector)) {
      if (!spec.factors.find(f => f.id === factor)?.levels.some(l => l.id === level)) throw new Error(`Unknown attachment or rule selection: ${factor}=${level}`);
    }
  }
  if (new Set(spec.attachments?.map(a => a.id)).size !== (spec.attachments?.length ?? 0)) throw new Error("An attachment may only be bound once");
  const rendered = buildConditions(spec);
  if (rendered.reduce((n,c) => n + c.userPrompt.length + c.systemPrompt.length, 0) * spec.models.length * spec.replicates > 100000000) throw new Error("Rendered batch exceeds 100 million characters; split it into smaller batches");
  return spec;
}
