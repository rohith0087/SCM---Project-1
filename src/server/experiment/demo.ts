import { createHash } from "node:crypto";
import type { Measure, PlannedRun } from "../../shared/experiment.js";
import type { ProviderCallOutput } from "../providers/base.js";

/** Deterministic plumbing fixture. These scores have no research interpretation. */
export async function experimentDemo(run: PlannedRun, measures: Measure[]): Promise<ProviderCallOutput> {
  await new Promise(resolve => setTimeout(resolve, 80));
  const bytes = createHash("sha256").update(run.runKey).digest();
  const values = Object.fromEntries(measures.map((m, i) => [m.id, m.type === "text"
    ? m.allowedValues?.[0] ?? "Synthetic fixture for pipeline validation; not a model judgment."
    : (m.min ?? 1) + bytes[i % bytes.length] % ((m.max ?? 7) - (m.min ?? 1) + 1)]));
  return { text: JSON.stringify(values), finishReason: "demo_complete", reportedModel: "synthetic-fixture", rawRequestId: `demo_${run.runKey}` };
}
