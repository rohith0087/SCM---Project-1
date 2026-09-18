import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMeasures } from "./parse.js";
import type { Measure } from "../../shared/experiment.js";

const MEASURES: Measure[] = [
  { id: "performance_rating", label: "Performance", type: "integer", min: 1, max: 7, required: true },
  { id: "disciplinary_likelihood", label: "Discipline", type: "integer", min: 1, max: 7, required: true },
  { id: "reasoning", label: "Reasoning", type: "text", required: false },
];

function body(extra = ""): string {
  return `{"performance_rating": 5, "disciplinary_likelihood": 2, "reasoning": "Handled calmly."${extra}}`;
}

test("reads a bare JSON object", () => {
  const result = parseMeasures(body(), MEASURES);
  assert.equal(result.status, "ok");
  assert.equal(result.values.performance_rating, 5);
  assert.equal(result.values.reasoning, "Handled calmly.");
});

test("reads JSON inside a fenced code block", () => {
  const result = parseMeasures("Here is my evaluation:\n\n```json\n" + body() + "\n```\n", MEASURES);
  assert.equal(result.status, "ok");
  assert.equal(result.values.disciplinary_likelihood, 2);
});

test("reads JSON that follows a paragraph of prose", () => {
  const result = parseMeasures(`I reviewed the report carefully. My ratings follow.\n\n${body()}`, MEASURES);
  assert.equal(result.status, "ok");
});

test("tolerates a trailing comma", () => {
  const result = parseMeasures('{"performance_rating": 4, "disciplinary_likelihood": 3, }', MEASURES);
  assert.equal(result.status, "ok");
  assert.equal(result.values.performance_rating, 4);
});

test("accepts numbers sent as strings", () => {
  const result = parseMeasures('{"performance_rating": "6", "disciplinary_likelihood": "1"}', MEASURES);
  assert.equal(result.status, "ok");
  assert.equal(result.values.performance_rating, 6);
});

test("rejects an echoed template instead of reading a number from it", () => {
  const result = parseMeasures('{"performance_rating": "[1-7]", "disciplinary_likelihood": "[1-7]"}', MEASURES);
  assert.equal(result.status, "invalid");
  assert.equal(result.values.performance_rating, null);
});

test("marks a refusal as missing and keeps nothing", () => {
  const result = parseMeasures("I'm not able to evaluate an employee based on this information.", MEASURES);
  assert.equal(result.status, "missing");
  assert.equal(result.values.performance_rating, null);
});

test("marks an absent required field invalid", () => {
  const result = parseMeasures('{"performance_rating": 5, "reasoning": "ok"}', MEASURES);
  assert.equal(result.status, "invalid");
  assert.match(result.notes ?? "", /disciplinary_likelihood missing/);
});

test("flags an out of range value as partial but keeps it", () => {
  const result = parseMeasures('{"performance_rating": 9, "disciplinary_likelihood": 3}', MEASURES);
  assert.equal(result.status, "partial");
  assert.equal(result.values.performance_rating, 9);
  assert.match(result.notes ?? "", /above 7/);
});

test("flags a non integer on an integer scale but keeps it", () => {
  const result = parseMeasures('{"performance_rating": 5.5, "disciplinary_likelihood": 3}', MEASURES);
  assert.equal(result.status, "partial");
  assert.equal(result.values.performance_rating, 5.5);
});

test("picks the object with the most expected keys when several appear", () => {
  const text = `Example of the format: {"foo": 1}\n\nMy answer:\n${body()}`;
  const result = parseMeasures(text, MEASURES);
  assert.equal(result.status, "ok");
  assert.equal(result.values.performance_rating, 5);
});

test("handles braces inside string values", () => {
  const text = '{"performance_rating": 3, "disciplinary_likelihood": 4, "reasoning": "They said {protect myself}."}';
  const result = parseMeasures(text, MEASURES);
  assert.equal(result.status, "ok");
  assert.equal(result.values.reasoning, "They said {protect myself}.");
});

test("handles an empty reply", () => {
  const result = parseMeasures("", MEASURES);
  assert.equal(result.status, "missing");
});
