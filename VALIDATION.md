# Validation status

## Configurable workspace update — September 28, 2026

Implemented local uploads/extraction, reference/stimulus review and mapping,
immutable study revisions, editable design/response fields, native image payloads,
provider setup, request timeouts and durable attempt limits, response search, and
complete ZIP exports.

After correcting the document preset to six numeric ratings plus reasoning:
- TypeScript: passed.
- Vite production build: passed.
- All 30 offline parser, pipeline and workspace tests: passed.
- API restarted; new routes are available and the browser's 404 banner is cleared.
- Study workspace is now the default page; comparison chat is explicitly optional.
- Results remain a primary download; supporting exports are under Advanced downloads.
- Browser workflow: loaded corrected preset, saved a revision, reviewed prompts,
  created and started synthetic pilot `5b5c0b1e-efba-4c87-9d83-00bcfccebef0`.
  All 192 demo calls completed (48 conditions × 4 lanes × 1 repetition), with
  192 valid responses and no flags/errors. This is software verification only.
- Verified ZIP download contents, six numeric columns plus reasoning, and
  filtered/paginated response API (48 matching OpenAI-lane records).
- Verified the optional comparison-chat explanation and return link to Study 2.

Tests cover DOCX/PDF extraction, custom designs, revision conflicts, attachment
integrity/archives, persisted call caps, mocked retries, pause handling, native
image transport inputs, and ledger failures. The previous approval-service block
has cleared. No live provider calls or real study collection were performed.

The checks below document the previous fixed-example workflow, not completion of
the new configurable workspace verification.

Revised experiment workflow verified locally on September 27–28, 2026.

## Completed checks

- TypeScript typecheck: passed.
- Vite production build: passed.
- Automated parser and pipeline tests: 20 passed, 0 failed.
- Browser workflow: reviewed the responsive experiment screen, created a demo
  batch, selected it from saved batches, and started it through the UI.
- Persisted demo batch `972bf03a-5fdf-489a-b3e9-a7ee2621a62e`: 48 recorded
  calls, 48 valid results, 0 flagged responses, 0 API failures.
- Download endpoints: results contained 48 unique run keys, all labeled demo,
  and 48 valid operational-risk ratings; completion CSV covered all 48 cells.
- Human-study materials endpoint: 12 scenarios and 7 shared rating definitions.
- Existing comparison smoke test: 4 results and 16 streamed events.

Automated checks cover the 48-condition/5,760-call expansion; matching human/LLM
complaint/report pairs; missing stimulus rejection; seven-rating validation;
immutable batch manifests; independent demo/live/model-change batches; exclusive
execution locks; pause/resume without duplicate records; rejection of edited
manifests and path traversal; live confirmation enforcement; and exclusion of
out-of-range ratings from valid completion counts.

## What these checks do not establish

No live provider calls were made. Provider credentials, current model access,
provider-specific parameter compatibility, API pricing, and genuine model response
format compliance must be checked with a separately reviewed live pilot. Synthetic
scores establish software behavior, not research findings or statistical validity.

Qualtrics survey deployment, recruitment, the name pretest, human exclusion rules,
preregistration, and statistical analysis have not been performed. The materials
export is not an importable Qualtrics QSF file.

## Reproduce

```bash
npm run typecheck
npm test
npm run build
# With DEMO_MODE=true and the local server running:
npm run smoke
npm run experiment -- run study2-driver-bias --replicates=1 --models=openai --mode=demo
```

Every experiment `run` creates a new batch. Use `resume <batch-id>` to continue an
existing batch. Tests use isolated temporary directories and make no provider calls.
