const payload = {
  runId: crypto.randomUUID(),
  prompt: "Return one short sentence describing what this research workbench does.",
  systemPrompt: "Be concise.",
  targets: [
    { id: "smoke-openai", provider: "openai", model: "gpt-5.6-sol", enabled: true, parameters: { maxTokens: 128 } },
    { id: "smoke-anthropic", provider: "anthropic", model: "claude-sonnet-5", enabled: true, parameters: { maxTokens: 128 } },
    { id: "smoke-google", provider: "google", model: "gemini-3.8-flash", enabled: true, parameters: { maxTokens: 128 } },
    { id: "smoke-xai", provider: "xai", model: "grok-4.6", enabled: true, parameters: { maxTokens: 128 } }
  ],
  conversations: []
};

const response = await fetch("http://localhost:8787/api/compare/stream", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});

if (!response.ok) throw new Error(`Smoke request failed: ${response.status} ${await response.text()}`);
const text = await response.text();
const lines = text.trim().split("\n").map((line) => JSON.parse(line));
const results = lines.filter((event) => event.type === "result");
const done = lines.find((event) => event.type === "done");

if (results.length !== 4 || !done) {
  console.error(text);
  throw new Error(`Expected 4 results and a done event; received ${results.length} results.`);
}

console.log(`Smoke test passed: ${results.length} model results, ${lines.length} streamed events.`);
