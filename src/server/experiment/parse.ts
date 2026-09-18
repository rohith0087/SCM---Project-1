import type { Measure, ParseStatus } from "../../shared/experiment.js";

/**
 * Extracts the measures from a model's reply.
 *
 * Models wrap JSON in prose, in code fences, or answer in a sentence and then
 * give the JSON. They also sometimes echo the template back verbatim, writing
 * "[1-7]" where a number belongs. All of that has to be detected rather than
 * coerced, because a quietly wrong number is far more damaging to a study than
 * a run marked invalid.
 */

export interface ParseResult {
  status: ParseStatus;
  values: Record<string, number | string | null>;
  notes?: string;
}

/** Walks the text pulling out every brace-balanced candidate object. */
function findJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }

  return candidates;
}

function stripFences(text: string): string {
  return text.replace(/```(?:json|JSON)?/g, "");
}

/** Removes trailing commas, which models emit often and JSON.parse rejects. */
function repair(candidate: string): string {
  return candidate.replace(/,(\s*[}\]])/g, "$1");
}

function coerceNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    // Reject an echoed template such as "[1-7]" rather than reading a 1 from it.
    if (/^\[?\d\s*-\s*\d\]?$/.test(trimmed)) return null;
    const match = trimmed.match(/^-?\d+(?:\.\d+)?$/);
    if (match) {
      const value = Number(trimmed);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

export function parseMeasures(rawText: string, measures: Measure[]): ParseResult {
  const values: Record<string, number | string | null> = {};
  for (const measure of measures) values[measure.id] = null;

  const text = stripFences(rawText ?? "");
  const candidates = findJsonCandidates(text);

  let best: Record<string, unknown> | undefined;
  let bestScore = -1;

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      try {
        parsed = JSON.parse(repair(candidate));
      } catch {
        continue;
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const object = parsed as Record<string, unknown>;
    // Prefer whichever object carries the most of the keys we asked for.
    const score = measures.filter((measure) =>
      Object.prototype.hasOwnProperty.call(object, measure.id),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      best = object;
    }
  }

  if (!best || bestScore <= 0) {
    return {
      status: "missing",
      values,
      notes: candidates.length
        ? "A JSON object was found but it contained none of the expected fields."
        : "No JSON object was found in the reply.",
    };
  }

  const problems: string[] = [];
  let missingRequired = 0;
  let outOfRange = 0;

  for (const measure of measures) {
    const raw = best[measure.id];

    if (measure.type === "text") {
      if (typeof raw === "string") values[measure.id] = raw;
      else if (raw != null) values[measure.id] = String(raw);
      else if (measure.required) {
        missingRequired += 1;
        problems.push(`${measure.id} missing`);
      }
      continue;
    }

    const value = coerceNumber(raw);
    if (value === null) {
      if (measure.required) {
        missingRequired += 1;
        problems.push(
          raw === undefined ? `${measure.id} missing` : `${measure.id} not numeric (${JSON.stringify(raw)})`,
        );
      }
      continue;
    }

    if (measure.type === "integer" && !Number.isInteger(value)) {
      // Kept, but flagged: a 6.5 on a 7 point scale is real data with a caveat.
      problems.push(`${measure.id} not an integer (${value})`);
      outOfRange += 1;
    }
    if (measure.min !== undefined && value < measure.min) {
      problems.push(`${measure.id} below ${measure.min} (${value})`);
      outOfRange += 1;
    }
    if (measure.max !== undefined && value > measure.max) {
      problems.push(`${measure.id} above ${measure.max} (${value})`);
      outOfRange += 1;
    }

    values[measure.id] = value;
  }

  let status: ParseStatus = "ok";
  if (missingRequired > 0) status = "invalid";
  else if (outOfRange > 0) status = "partial";

  return {
    status,
    values,
    notes: problems.length ? problems.join("; ") : undefined,
  };
}
