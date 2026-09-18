import { Annotation, END, Send, START, StateGraph } from "@langchain/langgraph";
import type {
  ChatMessage,
  CompareRequest,
  ModelResult,
  ModelTarget,
  TraceEvent,
} from "../shared/types.js";
import { getProviderAdapter } from "./providers/index.js";
import { effectiveParameters } from "./providers/base.js";

export type GraphObserver = (event: { trace?: TraceEvent; result?: ModelResult }) => void;

const ComparisonState = Annotation.Root({
  request: Annotation<CompareRequest>(),
  target: Annotation<ModelTarget | undefined>(),
  results: Annotation<ModelResult[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type State = typeof ComparisonState.State;

function trace(
  request: CompareRequest,
  stage: TraceEvent["stage"],
  message: string,
  target?: ModelTarget,
  durationMs?: number,
): TraceEvent {
  return {
    id: crypto.randomUUID(),
    runId: request.runId,
    stage,
    timestamp: new Date().toISOString(),
    targetId: target?.id,
    provider: target?.provider,
    model: target?.model,
    message,
    durationMs,
  };
}

function historyForTarget(request: CompareRequest, targetId: string): ChatMessage[] {
  const prior = request.conversations?.find((entry) => entry.targetId === targetId)?.messages ?? [];
  return [...prior, { role: "user", content: request.prompt }];
}

export function createComparisonGraph(observer: GraphObserver) {
  const dispatch = async (state: State) => {
    const active = state.request.targets.filter((target) => target.enabled);
    observer({
      trace: trace(
        state.request,
        "dispatch",
        `Dispatching one prompt to ${active.length} model${active.length === 1 ? "" : "s"} in parallel.`,
      ),
    });
    return {};
  };

  const routeModels = (state: State) =>
    state.request.targets
      .filter((target) => target.enabled)
      .map(
        (target) =>
          new Send("call_model", {
            request: state.request,
            target,
            results: [],
          }),
      );

  const callModel = async (state: State) => {
    const target = state.target;
    if (!target) return { results: [] };

    const startedAt = new Date();
    observer({
      trace: trace(
        state.request,
        "model_started",
        `${target.provider}/${target.model} request started.`,
        target,
      ),
    });

    const effectiveTarget: ModelTarget = {
      ...target,
      parameters: effectiveParameters(target),
    };

    try {
      const adapter = getProviderAdapter(target.provider);
      const output = await adapter({
        runId: state.request.runId,
        target: effectiveTarget,
        systemPrompt: state.request.systemPrompt,
        messages: historyForTarget(state.request, target.id),
      });
      const completedAt = new Date();
      const latencyMs = completedAt.getTime() - startedAt.getTime();
      const result: ModelResult = {
        runId: state.request.runId,
        targetId: target.id,
        provider: target.provider,
        model: target.model,
        text: output.text,
        latencyMs,
        usage: output.usage,
        finishReason: output.finishReason,
        rawRequestId: output.rawRequestId,
        parameters: effectiveTarget.parameters,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      };

      observer({ result });
      observer({
        trace: trace(
          state.request,
          "model_completed",
          `${target.provider}/${target.model} completed in ${latencyMs} ms.`,
          target,
          latencyMs,
        ),
      });
      return { results: [result] };
    } catch (error) {
      const completedAt = new Date();
      const latencyMs = completedAt.getTime() - startedAt.getTime();
      const message = error instanceof Error ? error.message : String(error);
      const result: ModelResult = {
        runId: state.request.runId,
        targetId: target.id,
        provider: target.provider,
        model: target.model,
        text: "",
        latencyMs,
        parameters: effectiveTarget.parameters,
        error: message,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      };

      observer({ result });
      observer({
        trace: trace(
          state.request,
          "model_failed",
          `${target.provider}/${target.model} failed: ${message}`,
          target,
          latencyMs,
        ),
      });
      return { results: [result] };
    }
  };

  return new StateGraph(ComparisonState)
    .addNode("dispatch", dispatch)
    .addNode("call_model", callModel)
    .addEdge(START, "dispatch")
    .addConditionalEdges("dispatch", routeModels)
    .addEdge("call_model", END)
    .compile();
}
