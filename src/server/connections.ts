import { Router } from "express";
import { readFile, writeFile, rename, lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isDemoMode } from "./catalog.js";
import { checkProviderConnection } from "./models.js";
import { getProviderAdapter } from "./providers/index.js";
import { effectiveParameters } from "./providers/base.js";
import { ModelSchema } from "./experiment/schema.js";
const Provider = z.enum(["openai", "anthropic", "google", "xai"]);
const KEYS = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", google: "GOOGLE_API_KEY", xai: "XAI_API_KEY" } as const;
export const connectionRouter = Router();
let writes = Promise.resolve();
function persist(name: string, value: string) {
  const task = writes.catch(() => {}).then(async () => {
    const file = path.resolve(".env");
    for (const target of [file, `${file}.tmp`]) {
      try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Environment files must not be symbolic links"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    let content = "";
    try { content = await readFile(file, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^\\s*${name}\\s*=.*$`, "gm");
    content = pattern.test(content) ? content.replace(pattern, line) : content + `\n${line}\n`;
    await writeFile(`${file}.tmp`, content, { mode: 0o600 }); await rename(`${file}.tmp`, file);
  });
  writes = task; return task;
}
connectionRouter.get("/connections", (_req, res) => res.json({ demoMode: isDemoMode(), providers: Object.entries(KEYS).map(([id, variable]) => ({ id, variable, configured: Boolean(process.env[variable]) })) }));
connectionRouter.post("/connections/:provider/key", async (req, res) => {
  const provider = Provider.parse(req.params.provider);
  const input = z.object({ key: z.string().min(8).max(1000).regex(/^[A-Za-z0-9_.-]+$/), persist: z.boolean().default(false) }).safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Invalid key format. Supply a provider API key without whitespace." }); return; }
  if (input.data.persist) await persist(KEYS[provider], input.data.key);
  process.env[KEYS[provider]] = input.data.key;
  res.json({ configured: true, persisted: input.data.persist });
});
connectionRouter.post("/connections/mode", async (req, res) => {
  const { demoMode } = z.object({ demoMode: z.boolean() }).parse(req.body);
  await persist("DEMO_MODE", String(demoMode)); process.env.DEMO_MODE = String(demoMode);
  res.json({ demoMode });
});
connectionRouter.post("/connections/:provider/check", async (req, res) => {
  const provider = Provider.parse(req.params.provider);
  if (!process.env[KEYS[provider]]) throw new Error("No key is configured for this provider");
  const models = await checkProviderConnection(provider);
  res.json({ ok: true, models, message: "Model catalog access verified. This does not verify generation or image support for a selected model." });
});
connectionRouter.post("/connections/:provider/probe", async (req, res) => {
  const provider = Provider.parse(req.params.provider);
  const { confirmed, model } = z.object({ confirmed: z.literal(true), model: ModelSchema }).parse(req.body);
  if (!confirmed || isDemoMode()) throw new Error("Disable demo mode and authorize the one-call generation test");
  if (model.provider !== provider) throw new Error("Provider mismatch");
  const target = { ...model, enabled: true, parameters: effectiveParameters({ ...model, enabled: true }) };
  const result = await getProviderAdapter(provider, false)({ runId: crypto.randomUUID(), target, messages: [{ role: "user", content: "Reply with the single word OK." }], signal: AbortSignal.timeout(60000) });
  res.json({ ok: true, text: result.text, reportedModel: result.reportedModel, usage: result.usage });
});
connectionRouter.use((error: Error, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  // Never return provider transport details or request objects which may contain keys.
  res.status(400).json({ error: error instanceof z.ZodError ? "Invalid connection request" : "Connection action failed. Check the key, account access, model ID, and network connection." });
});
