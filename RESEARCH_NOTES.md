# Research Notes: Comparing Frontier Models Responsibly

This tool makes cross-model collection convenient. It does not magically make cross-provider experiments scientifically equivalent. That would be suspiciously easy.

## 1. Separate single-turn and multi-turn experiments

On the first turn, every enabled lane receives the same user prompt and shared system prompt.

On later turns, each model receives:

1. the same sequence of user messages, and
2. **its own previous assistant responses**.

That is the correct behavior for comparing ongoing chat experiences, but the contexts naturally diverge after turn one. For strict prompt-response benchmarking, use a fresh experiment for each independent prompt.

## 2. Sampling parameters are not perfectly portable

`temperature = 0.7` at one provider does not guarantee the same entropy or decoding behavior at another provider. Some current reasoning models also restrict or deprecate sampling controls.

The interface therefore leaves parameters optional and stores exactly what you requested per lane.

## 3. Reasoning controls differ

- OpenAI GPT-6 Astra and GPT-5.6 expose model-specific reasoning effort levels.
- xAI Grok 4.6 exposes low/medium/high/xhigh reasoning effort.
- Gemini 3.8 uses low/medium/high thinking levels.
- Current effort-capable Claude models use low/medium/high/xhigh/max effort through `output_config.effort`.

Do not collapse these into one numeric "reasoning score" without defining a methodology first.

## 4. Token counts are provider-specific

Providers use different tokenizers and accounting rules. Some models can also spend hidden/internal reasoning tokens. Compare token counts as provider-reported cost/usage metadata, not as a universal measure of response length or cognitive effort.

## 5. Latency measurements include more than model speed

The app measures wall-clock time from immediately before the provider call until the SDK returns. That can include:

- network latency,
- provider queue time,
- inference time,
- reasoning time,
- provider-side post-processing.

For latency research, run repeated trials, randomize provider order if you later stop using parallel dispatch, and report distributions rather than one run.

## 6. Model aliases can move

For reproducible research, prefer pinned model IDs where the provider offers them. The UI intentionally lets you type exact model IDs rather than forcing a hard-coded dropdown.

## 7. Safety and system behavior differ

Provider-level safety policies, system instructions, hidden prompting, tool availability, and product defaults can affect answers. Record model IDs, date/time, parameters, and system prompts alongside outputs. JSON export preserves the session configuration for this purpose.

## 8. Suggested experiment record

For a publishable or repeatable comparison, retain at least:

- timestamp,
- provider,
- exact model ID,
- prompt and system prompt,
- full prior context,
- all requested parameters,
- raw response text,
- reported input/output/total tokens,
- latency,
- finish/error state,
- repeated trial number,
- manual or automated evaluation rubric.

The current JSON export captures most of this automatically.
