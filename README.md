# Frontier Model Lab

## Study 2 researcher workspace

Open `/#experiments` for the research pipeline. Its purpose is to let researchers
supply and run their own approved Study 2 protocol. Study 1 administration,
participant recruitment, methodological decisions, and statistical analysis are
outside this workflow. The document preset follows the explicit Study 2 template: six numeric ratings
plus reasoning, 48 conditions and 30 repetitions. Model lanes are editable
examples to review, not mandated model choices. Previous seven-rating batches
remain unchanged and are labeled as earlier configurations.

1. **Study setup:** start blank, upload the professor's materials, and review the
   extracted text against each original. Uploads default to reference-only and
   are never automatically interpreted as instructions or sent to providers.
2. **Prompts & conditions:** enter exact system/user prompts, factors and levels,
   variable substitutions, combination-specific scenario mappings, and response
   fields. Choose raw text or JSON validation with numeric bounds/text categories.
   Validation does not add response instructions to the prompt.
3. **Models & limits:** enter exact model IDs, repetitions, order seed, concurrency,
   retry count, timeout, and total request-attempt cap. Review both requested and
   effective provider parameters. Optional entered prices estimate text cost;
   this is not a dollar spending limit and excludes retries/image charges.
4. **Save revision, then review:** validate and inspect every rendered condition,
   including text and image stimuli. Approve that saved revision and create a
   demo or live batch. Creating a batch does not start requests.
5. **Connections:** configure provider keys for the session or explicitly save
   them in the ignored local `.env`. Check model-catalog access. A separately
   authorized, potentially paid generation probe checks a selected model.
6. **Saved batches:** start, pause, resume, inspect responses, and download exports.
   Live starts require explicit confirmation and demo mode to be disabled.

Uploads: DOCX, text PDF, UTF-8 TXT/MD/CSV/JSON, PNG, JPEG; 10 MB per file,
20 attachments per study, 100 PDF pages, 200,000 extracted characters. No OCR.
Word/PDF layout, images, comments, and reading order are not faithfully reproduced
as text. Review and correct the extracted text. Text stimuli are appended with
an `ATTACHMENT: filename` heading, visible in the preview; reference documents are
excluded. Selected PNG/JPEG stimuli travel as native image content. Support and
limits depend on the selected provider/model and require a reviewed live pilot.

**Exports:** Package is a ZIP containing the frozen manifest/specification,
conditions, results and completion CSVs, raw response/attempt logs where present,
and original attachments with hashes. Results is one row per planned call's
latest recorded result. Conditions contains rendered text prompts. Completion
reports expected/valid/flagged/error counts by condition and model. Manifest is
the JSON configuration and provenance record. `conditions.json` and the manifest
also identify image attachments. Exports retain flagged answers; they do not
decide research exclusions. API keys are not included.

Storage is under ignored `data/projects`, `data/assets`, and `data/batches`.
Back up `data/` while batches are paused; back up credentials separately if needed.
Revisions and batch configurations are immutable through the UI. A newer revision
must be loaded before another save; fork an old revision to create a new project.
The attempt cap persists across restarts. A crash after sending a request but
before saving its answer can cause that request to be sent again on resume and
billed twice; the attempt ledger retains its reservation. Pause stops scheduling
and lets in-flight calls finish. It does not cancel remote requests.

This is a local, single-server workspace. Keep the default loopback binding;
public or multi-user hosting needs authentication and access controls. Restart
the API process after backend source changes. A 404 banner after a frontend
update commonly means the browser is using new UI with an older API process.
See `VALIDATION.md` for the distinction between completed and pending checks.

Saved revisions can also be run from the CLI:

```bash
npm run experiment -- run --project=PROJECT_UUID --revision=REVISION_UUID --mode=demo --dry-run
npm run experiment -- run --project=PROJECT_UUID --revision=REVISION_UUID --mode=demo
```

A local, side-by-side research workbench for comparing responses from OpenAI, Anthropic, Google Gemini, and xAI using the same user prompt.

## What it does

- Sends one prompt to every enabled model lane in parallel.
- Uses **LangGraph** for fan-out / fan-in orchestration and emits a visible execution trace.
- Supports multiple lanes from the same provider, so you can compare model versions as well as vendors.
- Gives each lane independent parameters:
  - temperature
  - top-p
  - max output tokens
  - seed where supported
  - OpenAI/xAI reasoning effort
  - Gemini thinking level
- Preserves multi-turn chat history **independently for each model branch**.
- Captures response text, provider/model, latency, token usage, finish status, the normalized parameters actually sent, request ID (where available), and errors.
- Stores research sessions in browser `localStorage`.
- Keeps API keys server-side in `.env`.
- Exports a session as JSON or flattened CSV.
- Can refresh model catalogs from provider model-list APIs when an API key is configured.
- Includes `DEMO_MODE` for exercising the full UI and LangGraph pipeline without spending API credits.

## Architecture

```text
Browser / React
  |
  | POST /api/compare/stream (NDJSON)
  v
Express API
  |
  v
LangGraph
  START
    |
  dispatch
    |-------------------|------------------|------------------|
    v                   v                  v                  v
 OpenAI              Anthropic           Google              xAI
 Responses API       Messages API        Gemini API          Responses API
    |                   |                  |                  |
    |-------------------|------------------|------------------|
                            |
                            v
                       result reducer
                            |
                           END
```

The browser receives trace and result events as newline-delimited JSON while the graph is running, so one slow or failed provider does not block already-completed lanes from appearing in the UI.

## Quick start

### 1. Install

Requires Node.js 22+.

```bash
npm install
```

### 2. Configure provider keys

macOS/Linux:

```bash
cp .env.example .env
```

Windows PowerShell / Command Prompt:

```bat
copy .env.example .env
```

Add any providers you want to use:

```env
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_API_KEY=...
XAI_API_KEY=...
DEMO_MODE=false
HOST=127.0.0.1
PORT=8787
```

You do **not** need all four keys. Lanes without a configured provider key will return a visible error while other lanes continue.

### 3. Start development mode

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

Vite proxies `/api` to the loopback-only Express server on port `8787`.

## Demo mode

### Revised research experiments

Open `http://localhost:5173/#experiments`, or choose **Research experiments** in
the comparison sidebar. The research workspace implements the revised
3 identities × 2 behaviors × 2 escalation levels × 4 system prompts design:
48 conditions, 1,440 calls per model at 30 repetitions. All seven rating outcomes
are shared with Study 1, including operational/service continuity risk.
Categorical employment decisions are excluded from this version.

1. Review any condition's exact system prompt and scenario.
2. Select model lanes, exact model IDs, parameters, and repetitions (default: one
   repetition on one model, 48 calls).
3. Create a batch to freeze that configuration, then start it from Saved batches.
4. Pause/resume, inspect coverage and raw responses, and export results,
   conditions, completion counts, and the manifest.

Demo batches use deterministic structured fixtures with valid ratings and are
marked synthetic in the UI, manifest, and result rows. They do not call any AI
provider and must not be used as research observations. Live batches require
configured keys, `DEMO_MODE=false`, and explicit confirmation in the UI or CLI.
Exact model IDs and provider compatibility still require a live pilot.

Every batch is stored under `data/batches/<batch-id>/` with a frozen manifest and
append-only `runs.ndjson`. A changed prompt, model, mode, or repetition count
requires a new batch. Legacy `data/<experiment-id>/` results remain untouched
and are not resumed automatically. A process lock prevents simultaneous CLI and
browser execution of the same batch. After a process restart, resume the saved
batch; completed calls are retained. Hard termination can lose in-flight calls.
If a record is corrupt, resumption stops for review rather than silently skipping it.

Only complete, integer, in-range ratings count as valid. Possible refusals are
flagged using text heuristics and need manual review. Invalid and refused
responses remain in exports; they are never automatically replaced. Temporary
API failures use backoff; an explicit **Retry API errors** action can retry final
API failures. Exports use the latest attempt per planned call while the raw
append-only log retains earlier records. A finished batch may contain errors.

Pricing inputs are user-entered USD per million tokens. The displayed estimate
uses approximate input counts and configured output limits, excluding retries
and provider-specific charges. It is not a spending cap or a quote.

Human-study downloads provide 12 matched scenarios, seven rating definitions,
checks, recruitment criteria, and import column names. They are survey-building
materials, **not a Qualtrics QSF import or a deployed survey**. The independent
name pretest, identity-check response options, exclusion rules, human pilot,
preregistration, recruitment, and statistical analysis remain separate work.

CLI examples (a new `run` creates a new batch):

```bash
npm run experiment -- plan study2-driver-bias --replicates=1 --models=openai
npm run experiment -- run study2-driver-bias --replicates=1 --models=openai --mode=demo
npm run experiment -- resume <batch-id>
npm run experiment -- status <batch-id>
npm run experiment -- export <batch-id>
npm run experiment -- materials --out=study1-materials.json
```

`plan`, `preview`, `status`, and `run --dry-run` do not write batch manifests.
Live execution requires `--confirm-live`. Resume always uses the stored settings.

To test the entire workflow without making paid API requests:

```env
DEMO_MODE=true
```

Then run:

```bash
npm run dev
```

Every provider lane returns a synthetic response after a simulated delay. The LangGraph execution, streaming UI, traces, localStorage, history, and exports still work normally.

## Production-style local run

```bash
npm run build
npm start
```

Then open:

```text
http://localhost:8787
```

Express serves the built React application from `dist/`.

## Smoke test

With the server already running in `DEMO_MODE=true`:

```bash
npm run smoke
```

The smoke script submits one request to four lanes and verifies that four result events plus a final completion event are returned.

## Storage model

Research sessions are stored under this browser-local key:

```text
frontier-model-lab:sessions:v1
```

This was intentionally kept simple for a local research prototype. Browser localStorage is limited, so very large research programs should move session persistence to IndexedDB or a local SQLite/Postgres layer.

API keys are never written to localStorage. They remain in the local server process through environment variables. The server binds to `127.0.0.1` by default so the unauthenticated local research endpoint is not exposed to your LAN; change `HOST` only if you deliberately want remote access and add authentication first.

## Provider notes

### OpenAI

Uses the Responses API. Current OpenAI frontier models are available through Responses, and the UI lets you provide any exact API model ID. The fallback catalog includes the current GPT-6 Astra plus GPT-5.6 Sol/Terra/Luna IDs. The adapter omits temperature/top-p for GPT-6 Astra because that model does not accept those sampling controls.

### Anthropic

Uses the Messages API. Model IDs are editable and can also be refreshed from Anthropic's model-list endpoint. Current Claude models expose effort through `output_config.effort`; the UI supports it on recognized effort-capable models and suppresses custom sampling on modern models that reject it.

### Google Gemini

Uses `@google/genai` `models.generateContent` for broad model compatibility and branch-local chat history. Gemini 3.8 deprecates temperature/top-p sampling controls, so this adapter omits those values for `gemini-3.8*` and exposes Gemini thinking level instead.

### xAI

Uses xAI's OpenAI-compatible Responses API at `https://api.x.ai/v1`. Grok 4.6 supports low/medium/high/xhigh reasoning effort.

## Research caveats

Do not treat identical numeric parameters as perfectly identical experimental conditions across providers. See [`RESEARCH_NOTES.md`](./RESEARCH_NOTES.md) before drawing conclusions from response quality, token counts, or latency.

## Project structure

```text
frontier-model-lab/
├─ src/
│  ├─ client/
│  │  ├─ components/
│  │  │  ├─ ModelLane.tsx
│  │  │  ├─ ResultCard.tsx
│  │  │  └─ TracePanel.tsx
│  │  ├─ lib/
│  │  │  ├─ api.ts
│  │  │  ├─ export.ts
│  │  │  └─ storage.ts
│  │  ├─ App.tsx
│  │  ├─ main.tsx
│  │  └─ styles.css
│  ├─ server/
│  │  ├─ providers/
│  │  │  ├─ anthropic.ts
│  │  │  ├─ google.ts
│  │  │  ├─ openai.ts
│  │  │  └─ xai.ts
│  │  ├─ catalog.ts
│  │  ├─ graph.ts
│  │  ├─ index.ts
│  │  └─ models.ts
│  └─ shared/types.ts
├─ scripts/smoke.mjs
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ vite.config.ts
```

## Extending it

The provider boundary is intentionally narrow. To add another provider, implement the `ProviderAdapter` interface in `src/server/providers/`, add the provider ID to the shared types/catalog, and expose its model list. The rest of the graph and UI can remain unchanged.
