import {
  Activity,
  ChevronDown,
  Download,
  FlaskConical,
  Moon,
  Pencil,
  Play,
  Plus,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  CompareRequest,
  ModelResult,
  ModelTarget,
  ProviderConversation,
  ProviderId,
  ProviderStatus,
  ResearchSession,
  SessionTurn,
  StreamEvent,
  TraceEvent,
} from "@shared/types";
import { ModelLane } from "./components/ModelLane";
import { ResultCard } from "./components/ResultCard";
import { TracePanel } from "./components/TracePanel";
import { fetchModels, fetchProviders, streamComparison } from "./lib/api";
import { exportSessionCsv, exportSessionJson } from "./lib/export";
import { loadSessions, saveSessions } from "./lib/storage";

const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: "gpt-6-astra",
  anthropic: "claude-opus-5",
  google: "gemini-3.8-flash",
  xai: "grok-4.6",
};

const THEME_KEY = "frontier-model-lab:theme";

function makeTarget(provider: ProviderId, model = DEFAULT_MODELS[provider]): ModelTarget {
  return {
    id: crypto.randomUUID(),
    provider,
    model,
    enabled: true,
    parameters: { maxTokens: 8192 },
  };
}

function newSession(): ResearchSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "Untitled comparison",
    createdAt: now,
    updatedAt: now,
    systemPrompt: "",
    targets: [makeTarget("openai"), makeTarget("anthropic"), makeTarget("google"), makeTarget("xai")],
    turns: [],
  };
}

function buildConversations(session: ResearchSession): ProviderConversation[] {
  return session.targets.map((target) => {
    const messages = session.turns.flatMap((turn) => {
      const result = turn.results.find((entry) => entry.targetId === target.id);
      const base = [{ role: "user" as const, content: turn.prompt }];
      if (!result || result.error || !result.text) return base;
      return [...base, { role: "assistant" as const, content: result.text }];
    });
    return { targetId: target.id, messages };
  });
}

function modelMapKey(provider: ProviderId) {
  return `provider:${provider}`;
}

export default function App() {
  const [sessions, setSessions] = useState<ResearchSession[]>(() => {
    const saved = loadSessions();
    return saved.length ? saved : [newSession()];
  });
  const [activeId, setActiveId] = useState(() => sessions[0]?.id ?? "");
  const [prompt, setPrompt] = useState("");
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [modelsLive, setModelsLive] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [liveResults, setLiveResults] = useState<ModelResult[]>([]);
  const [liveTraces, setLiveTraces] = useState<TraceEvent[]>([]);
  const [showTrace, setShowTrace] = useState(false);
  const [showSetup, setShowSetup] = useState(() => (sessions[0]?.turns.length ?? 0) === 0);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // Storage can be blocked; fall through to the default.
    }
    return "light";
  });


  const session = sessions.find((entry) => entry.id === activeId) ?? sessions[0];

  useEffect(() => saveSessions(sessions), [sessions]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Remembering the theme is a convenience, not a requirement.
    }
  }, [theme]);

  useEffect(() => {
    fetchProviders().then(setProviderStatuses).catch(console.error);
    (Object.keys(DEFAULT_MODELS) as ProviderId[]).forEach((provider) => {
      void refreshModels(provider, false);
    });
  }, []);

  useEffect(() => {
    setSelectedTurnId(null);
    setLiveResults([]);
    setLiveTraces([]);
    setFatalError(null);
    setRenaming(false);
  }, [activeId]);

  const updateSession = (updater: (current: ResearchSession) => ResearchSession) => {
    setSessions((current) =>
      current.map((entry) => (entry.id === activeId ? updater(entry) : entry)),
    );
  };

  const refreshModels = async (provider: ProviderId, refresh = true) => {
    try {
      const data = await fetchModels(provider, refresh);
      setModels((current) => ({ ...current, [modelMapKey(provider)]: data.models }));
      setModelsLive((current) => ({ ...current, [modelMapKey(provider)]: data.live }));
    } catch (error) {
      console.warn(error);
    }
  };

  const currentTurn = useMemo(() => {
    if (!session) return undefined;
    if (selectedTurnId) return session.turns.find((turn) => turn.id === selectedTurnId);
    return session.turns.at(-1);
  }, [session, selectedTurnId]);

  const displayedResults = running ? liveResults : currentTurn?.results ?? [];
  const displayedTraces = running ? liveTraces : currentTurn?.traces ?? [];
  const enabledTargets = session?.targets.filter((target) => target.enabled) ?? [];
  const demoMode = providerStatuses.some((status) => status.demoMode);

  const fastestTargetId = useMemo(() => {
    const finished = displayedResults.filter((result) => !result.error);
    if (finished.length < 2) return undefined;
    return finished.reduce((best, entry) => (entry.latencyMs < best.latencyMs ? entry : best)).targetId;
  }, [displayedResults]);

  const handleRun = async (overridePrompt?: string) => {
    const text = (overridePrompt ?? prompt).trim();
    if (!session || !text || running) return;
    const activeTargets = session.targets.filter((target) => target.enabled && target.model.trim());
    if (!activeTargets.length) {
      setFatalError("Turn on at least one model and give it a version before running a comparison.");
      return;
    }

    const runId = crypto.randomUUID();
    const turnId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const collectedResults: ModelResult[] = [];
    const collectedTraces: TraceEvent[] = [];

    setRunning(true);
    setFatalError(null);
    setLiveResults([]);
    setLiveTraces([]);
    setSelectedTurnId(null);
    setShowSetup(false);

    const request: CompareRequest = {
      runId,
      prompt: text,
      systemPrompt: session.systemPrompt,
      targets: session.targets,
      conversations: buildConversations(session),
    };

    const onEvent = (event: StreamEvent) => {
      if (event.type === "trace") {
        collectedTraces.push(event.data);
        setLiveTraces([...collectedTraces]);
      } else if (event.type === "result") {
        collectedResults.push(event.data);
        setLiveResults([...collectedResults]);
      } else if (event.type === "fatal") {
        setFatalError(event.data.error);
      }
    };

    try {
      await streamComparison(request, onEvent);
      const turn: SessionTurn = {
        id: turnId,
        prompt: text,
        createdAt,
        results: collectedResults,
        traces: collectedTraces,
      };
      updateSession((current) => ({
        ...current,
        title: current.turns.length === 0 ? text.slice(0, 58) : current.title,
        updatedAt: new Date().toISOString(),
        turns: [...current.turns, turn],
      }));
      setPrompt("");
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        setFatalError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setRunning(false);
    }
  };

  const createNew = () => {
    const next = newSession();
    setSessions((current) => [next, ...current]);
    setActiveId(next.id);
    setShowSetup(true);
  };

  const deleteActive = () => {
    if (!session) return;
    const remaining = sessions.filter((entry) => entry.id !== session.id);
    const next = remaining.length ? remaining : [newSession()];
    setSessions(next);
    setActiveId(next[0].id);
  };

  if (!session) return null;

  const missingKeys = providerStatuses.filter((status) => !status.configured);
  const turnNumber = currentTurn ? session.turns.findIndex((turn) => turn.id === currentTurn.id) + 1 : 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <FlaskConical size={18} />
          </div>
          <div className="brand-text">
            <strong>Model Compare</strong>
            <span>Ask four AI vendors the same question</span>
          </div>
        </div>

        <button className="primary-button block" type="button" onClick={createNew}>
          <Plus size={16} /> New comparison
        </button>

        <div className="sidebar-label">Saved comparisons</div>
        <nav className="session-list">
          {sessions.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`session-item ${entry.id === activeId ? "active" : ""}`}
              onClick={() => setActiveId(entry.id)}
            >
              <span className="session-title">{entry.title || "Untitled comparison"}</span>
              <span className="session-meta">
                {entry.turns.length === 0
                  ? "No questions yet"
                  : `${entry.turns.length} question${entry.turns.length === 1 ? "" : "s"}`}
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="vendor-status">
            {providerStatuses.map((status) => (
              <div key={status.id}>
                <span className={`status-dot ${status.configured ? "ok" : "off"}`} />
                {status.label}
              </div>
            ))}
          </div>
          <p className="fine-print">
            Your keys stay on this computer. Comparisons are saved in this browser only.
          </p>
          <button className="theme-toggle" type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
            {theme === "light" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            {renaming ? (
              <input
                className="title-input"
                autoFocus
                value={session.title}
                onChange={(event) =>
                  updateSession((current) => ({ ...current, title: event.target.value }))
                }
                onBlur={() => setRenaming(false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <button type="button" className="title-button" onClick={() => setRenaming(true)} title="Rename">
                <h1>{session.title || "Untitled comparison"}</h1>
                <Pencil size={14} />
              </button>
            )}
            <p className="topbar-sub">
              {enabledTargets.length} model{enabledTargets.length === 1 ? "" : "s"} selected
              {demoMode && " · demo mode, no live AI calls"}
            </p>
          </div>

          <div className="topbar-actions">
            <button className="ghost-button" type="button" onClick={() => setShowSetup((value) => !value)}>
              Choose models
              <ChevronDown size={14} className={showSetup ? "chevron open" : "chevron"} />
            </button>
            <button className="ghost-button" type="button" onClick={() => setShowTrace(true)}>
              <Activity size={15} /> Run activity
            </button>
            <div className="menu-group">
              <button className="ghost-button" type="button" onClick={() => exportSessionCsv(session)}>
                <Download size={15} /> Spreadsheet
              </button>
              <button className="ghost-button" type="button" onClick={() => exportSessionJson(session)}>
                Data file
              </button>
            </div>
            <button className="ghost-button danger" type="button" onClick={deleteActive} title="Delete this comparison">
              <Trash2 size={15} />
            </button>
          </div>
        </header>

        <div className="scroll-area">
          {demoMode && (
            <div className="notice">
              <strong>Demo mode is on.</strong> Answers below are samples, not real AI responses. Add vendor keys to the
              server's settings file and switch demo mode off to run live.
            </div>
          )}

          {!demoMode && missingKeys.length > 0 && (
            <div className="notice warn">
              <strong>
                No key for {missingKeys.map((status) => status.label).join(", ")}.
              </strong>{" "}
              Those models will report an error. The rest will still answer.
            </div>
          )}

          {showSetup && (
            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>Which models to compare</h2>
                  <p>Turn a model on or off, or open its settings to change the version and how it answers.</p>
                </div>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() =>
                    updateSession((current) => ({
                      ...current,
                      updatedAt: new Date().toISOString(),
                      targets: [...current.targets, makeTarget("openai")],
                    }))
                  }
                >
                  <Plus size={14} /> Add a model
                </button>
              </div>

              <div className="model-list">
                {session.targets.map((target, index) => (
                  <ModelLane
                    key={target.id}
                    target={target}
                    index={index}
                    models={models[modelMapKey(target.provider)] ?? []}
                    statuses={providerStatuses}
                    canRemove={session.targets.length > 1}
                    onRefreshModels={() => void refreshModels(target.provider, true)}
                    onDuplicate={() =>
                      updateSession((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        targets: [
                          ...current.targets,
                          { ...target, id: crypto.randomUUID(), parameters: { ...target.parameters } },
                        ],
                      }))
                    }
                    onRemove={() =>
                      updateSession((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        targets: current.targets.filter((entry) => entry.id !== target.id),
                      }))
                    }
                    onChange={(next) =>
                      updateSession((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        targets: current.targets.map((entry) => (entry.id === next.id ? next : entry)),
                      }))
                    }
                  />
                ))}
              </div>

              <label className="field standing-instructions">
                <span className="field-label">Standing instructions (optional)</span>
                <textarea
                  rows={2}
                  value={session.systemPrompt}
                  placeholder="For example: You are a supply chain analyst. Answer in bullet points and flag any assumptions."
                  onChange={(event) =>
                    updateSession((current) => ({
                      ...current,
                      updatedAt: new Date().toISOString(),
                      systemPrompt: event.target.value,
                    }))
                  }
                />
                <span className="field-hint">Sent to every model with every question, so they all start from the same brief.</span>
              </label>
            </section>
          )}

          {session.turns.length > 0 && (
            <div className="turn-bar">
              <span className="turn-bar-label">Questions</span>
              {session.turns.map((turn, index) => (
                <button
                  type="button"
                  key={turn.id}
                  title={turn.prompt}
                  className={currentTurn?.id === turn.id && !running ? "active" : ""}
                  onClick={() => setSelectedTurnId(turn.id)}
                >
                  {index + 1}
                </button>
              ))}
              <button type="button" className="wide" onClick={() => setSelectedTurnId(null)}>
                Latest
              </button>
            </div>
          )}

          {fatalError && <div className="notice error">{fatalError}</div>}

          {session.turns.length === 0 && !running ? (
            <section className={`welcome ${prompt.trim() ? "is-dimmed" : ""}`}>
              <p className="welcome-line">Ready when you are.</p>
            </section>
          ) : (
            <section className="answers-section">
              <div className="panel-head">
                <div>
                  <h2>{running ? "Answers coming in…" : `Question ${turnNumber}`}</h2>
                  {currentTurn && !running && <p className="asked-question">“{currentTurn.prompt}”</p>}
                </div>
              </div>

              <div className="answers-grid">
                {session.targets
                  .filter((target) => target.enabled)
                  .map((target) => (
                    <ResultCard
                      key={target.id}
                      target={target}
                      result={displayedResults.find((result) => result.targetId === target.id)}
                      running={running}
                      fastest={fastestTargetId === target.id}
                    />
                  ))}
              </div>
            </section>
          )}
        </div>

        <footer className="composer-bar">
          <div className="composer">
            <textarea

              value={prompt}
              disabled={running}
              rows={2}
              placeholder="Ask every selected model the same question…"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handleRun();
                }
              }}
            />
            <div className="composer-foot">
              <span className="fine-print">
                Press Ctrl and Enter to send. Each model remembers its own side of the conversation.
              </span>
              <button
                className="primary-button"
                type="button"
                disabled={running || !prompt.trim()}
                onClick={() => void handleRun()}
              >
                <Play size={15} /> {running ? "Asking…" : "Ask all models"}
              </button>
            </div>
          </div>
        </footer>
      </main>

      {showTrace && <TracePanel traces={displayedTraces} onClose={() => setShowTrace(false)} />}
    </div>
  );
}
