import type { ExperimentSpec } from "../shared/experiment.js";
import study2DriverBias from "./study2-driver-bias.js";

/** Every experiment the server and CLI can run, keyed by spec id. */
export const EXPERIMENTS: Record<string, ExperimentSpec> = {
  [study2DriverBias.id]: study2DriverBias,
};

export function getExperiment(id: string): ExperimentSpec | undefined {
  return EXPERIMENTS[id];
}

export function listExperiments(): ExperimentSpec[] {
  return Object.values(EXPERIMENTS);
}
