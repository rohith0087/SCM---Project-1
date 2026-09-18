import { createHash } from "node:crypto";
import type {
  Condition,
  ExperimentSpec,
  Factor,
  FactorLevel,
  PlannedRun,
} from "../../shared/experiment.js";

/**
 * Turns a declared design into the concrete list of calls to make.
 *
 * Execution order is shuffled so that a condition is not correlated with time.
 * Vendors change models and load during a long batch, and running every Jamal
 * cell before every Connor cell would confound identity with that drift. The
 * shuffle is seeded so the order can be reproduced exactly.
 */

/** Small deterministic PRNG, adequate for ordering and fully reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], seed: number): T[] {
  const random = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Replaces {{name}} placeholders. Unknown placeholders are left untouched. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/** Every combination taking one level from each factor, in declared order. */
function cartesian(factors: Factor[]): FactorLevel[][] {
  return factors.reduce<FactorLevel[][]>(
    (acc, factor) => acc.flatMap((combo) => factor.levels.map((level) => [...combo, level])),
    [[]],
  );
}

export function listUnresolvedPlaceholders(spec: ExperimentSpec): string[] {
  const provided = new Set<string>();
  for (const factor of spec.factors) {
    for (const level of factor.levels) {
      for (const key of Object.keys(level.vars ?? {})) provided.add(key);
    }
  }
  const used = [...spec.userPromptTemplate.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(used)].filter((key) => !provided.has(key));
}

export function buildConditions(spec: ExperimentSpec): Condition[] {
  return cartesian(spec.factors).map((combo) => {
    const cells: Record<string, string> = {};
    const cellLabels: Record<string, string> = {};
    const vars: Record<string, string> = {};
    let systemPrompt = spec.systemPrompt ?? "";

    combo.forEach((level, index) => {
      const factor = spec.factors[index];
      cells[factor.id] = level.id;
      cellLabels[factor.id] = level.label;
      Object.assign(vars, level.vars ?? {});
      if (level.systemPrompt !== undefined) systemPrompt = level.systemPrompt;
    });

    const id = spec.factors.map((factor) => `${factor.id}=${cells[factor.id]}`).join("|");

    return {
      id,
      cells,
      cellLabels,
      systemPrompt,
      userPrompt: render(spec.userPromptTemplate, vars),
    };
  });
}

/**
 * Expands conditions across models and replicates.
 *
 * `runKey` is derived only from the design coordinates, never from a timestamp
 * or random value, so a resumed batch can tell exactly which calls are already
 * on disk and skip them.
 */
export function planRuns(spec: ExperimentSpec): PlannedRun[] {
  const conditions = buildConditions(spec);
  const planned: Omit<PlannedRun, "order">[] = [];

  for (const condition of conditions) {
    for (const model of spec.models) {
      for (let replicate = 1; replicate <= spec.replicates; replicate += 1) {
        planned.push({
          runKey: `${condition.id}|model=${model.id}|rep=${replicate}`,
          conditionId: condition.id,
          cells: condition.cells,
          cellLabels: condition.cellLabels,
          modelId: model.id,
          provider: model.provider,
          model: model.model,
          parameters: model.parameters ?? {},
          replicate,
          systemPrompt: condition.systemPrompt,
          userPrompt: condition.userPrompt,
        });
      }
    }
  }

  return shuffle(planned, spec.seed ?? 1).map((run, index) => ({ ...run, order: index + 1 }));
}

export interface DesignSummary {
  conditions: number;
  models: number;
  replicates: number;
  totalRuns: number;
  runsPerModel: number;
  factors: Array<{ id: string; label: string; levels: number }>;
  warnings: string[];
}

export function summarise(spec: ExperimentSpec): DesignSummary {
  const conditions = spec.factors.reduce((total, factor) => total * factor.levels.length, 1);
  const warnings: string[] = [];

  const unresolved = listUnresolvedPlaceholders(spec);
  if (unresolved.length) {
    warnings.push(
      `The user prompt uses placeholders no factor supplies: ${unresolved.join(", ")}.`,
    );
  }

  const suppliesSystemPrompt = spec.factors.some((factor) =>
    factor.levels.some((level) => level.systemPrompt !== undefined),
  );
  if (!suppliesSystemPrompt && !spec.systemPrompt) {
    warnings.push("No factor level and no fallback supplies a system prompt.");
  }

  for (const factor of spec.factors) {
    if (factor.levels.length < 2) {
      warnings.push(`Factor "${factor.id}" has fewer than two levels, so it varies nothing.`);
    }
  }

  if (spec.replicates < 2) {
    warnings.push("Fewer than two replicates cannot show sampling variation.");
  }

  return {
    conditions,
    models: spec.models.length,
    replicates: spec.replicates,
    totalRuns: conditions * spec.models.length * spec.replicates,
    runsPerModel: conditions * spec.replicates,
    factors: spec.factors.map((factor) => ({
      id: factor.id,
      label: factor.label,
      levels: factor.levels.length,
    })),
    warnings,
  };
}
