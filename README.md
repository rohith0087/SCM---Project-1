# Frontier Model Lab

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
