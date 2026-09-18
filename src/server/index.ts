import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createComparisonGraph } from "./graph.js";
import { getModels } from "./models.js";
import { providerStatuses } from "./catalog.js";
import type { CompareRequest, ProviderId, StreamEvent } from "../shared/types.js";

try {
  process.loadEnvFile?.(".env");
} catch {
  // .env is optional; environment variables may be supplied by the shell/runtime.
}

const ProviderSchema = z.enum(["openai", "anthropic", "google", "xai"]);
const ParametersSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().positive().max(200000).optional(),
  seed: z.number().int().optional(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  thinkingLevel: z.enum(["low", "medium", "high"]).optional(),
});
const TargetSchema = z.object({
  id: z.string().min(1),
  provider: ProviderSchema,
  model: z.string().min(1),
  enabled: z.boolean(),
  parameters: ParametersSchema,
});
const MessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string() });
const RequestSchema = z.object({
  runId: z.string().min(1),
  prompt: z.string().min(1),
  systemPrompt: z.string().optional(),
  targets: z.array(TargetSchema).min(1).max(12),
  conversations: z
    .array(z.object({ targetId: z.string(), messages: z.array(MessageSchema).max(100) }))
    .optional(),
});

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get("/api/providers", (_req, res) => {
  res.json({ providers: providerStatuses() });
});

app.get("/api/models/:provider", async (req, res) => {
  const parsed = ProviderSchema.safeParse(req.params.provider);
  if (!parsed.success) return res.status(400).json({ error: "Unknown provider." });
  const refresh = req.query.refresh === "true";
  const result = await getModels(parsed.data as ProviderId, refresh);
  res.json(result);
});

app.post("/api/compare/stream", async (req, res) => {
  const parsed = RequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid comparison request.", details: parsed.error.flatten() });
  }

  const request = parsed.data as CompareRequest;
  const activeTargets = request.targets.filter((target) => target.enabled);
  if (!activeTargets.length) return res.status(400).json({ error: "Enable at least one model lane." });

  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: StreamEvent) => res.write(`${JSON.stringify(event)}\n`);

  send({
    type: "trace",
    data: {
      id: crypto.randomUUID(),
      runId: request.runId,
      stage: "graph_started",
      timestamp: new Date().toISOString(),
      message: `LangGraph run started with ${activeTargets.length} active lane${activeTargets.length === 1 ? "" : "s"}.`,
    },
  });

  try {
    const graph = createComparisonGraph(({ trace, result }) => {
      if (trace) send({ type: "trace", data: trace });
      if (result) send({ type: "result", data: result });
    });
    const finalState = await graph.invoke({ request, target: undefined, results: [] });

    send({
      type: "trace",
      data: {
        id: crypto.randomUUID(),
        runId: request.runId,
        stage: "graph_completed",
        timestamp: new Date().toISOString(),
        message: `LangGraph run completed with ${finalState.results.length} result${finalState.results.length === 1 ? "" : "s"}.`,
      },
    });
    send({ type: "done", data: { runId: request.runId, resultCount: finalState.results.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send({ type: "fatal", data: { runId: request.runId, error: message } });
  } finally {
    res.end();
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, "../../dist");
app.use(express.static(dist));
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(dist, "index.html"), (error) => {
    if (error) next(error);
  });
});

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Frontier Model Lab server listening on http://${host}:${port}`);
});
