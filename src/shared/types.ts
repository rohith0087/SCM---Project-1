export type ProviderId = "openai" | "anthropic" | "google" | "xai";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelParameters {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  seed?: number;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  thinkingLevel?: "low" | "medium" | "high";
}

export interface ModelTarget {
  id: string;
  provider: ProviderId;
  model: string;
  enabled: boolean;
  parameters: ModelParameters;
}

export interface ProviderConversation {
  targetId: string;
  messages: ChatMessage[];
}

export interface CompareRequest {
  runId: string;
  prompt: string;
  systemPrompt?: string;
  targets: ModelTarget[];
  conversations?: ProviderConversation[];
}

export interface UsageStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelResult {
  runId: string;
  targetId: string;
  provider: ProviderId;
  model: string;
  text: string;
  latencyMs: number;
  usage?: UsageStats;
  finishReason?: string;
  parameters: ModelParameters;
  error?: string;
  rawRequestId?: string;
  startedAt: string;
  completedAt: string;
}

export type TraceStage =
  | "graph_started"
  | "dispatch"
  | "model_started"
  | "model_completed"
  | "model_failed"
  | "graph_completed";

export interface TraceEvent {
  id: string;
  runId: string;
  stage: TraceStage;
  timestamp: string;
  targetId?: string;
  provider?: ProviderId;
  model?: string;
  message: string;
  durationMs?: number;
}

export type StreamEvent =
  | { type: "trace"; data: TraceEvent }
  | { type: "result"; data: ModelResult }
  | { type: "done"; data: { runId: string; resultCount: number } }
  | { type: "fatal"; data: { runId: string; error: string } };

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  demoMode: boolean;
}

export interface SessionTurn {
  id: string;
  prompt: string;
  createdAt: string;
  results: ModelResult[];
  traces: TraceEvent[];
}

export interface ResearchSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  systemPrompt: string;
  targets: ModelTarget[];
  turns: SessionTurn[];
}
