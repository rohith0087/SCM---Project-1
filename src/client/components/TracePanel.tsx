import { CheckCircle2, CircleDashed, PlayCircle, Send, TriangleAlert, X } from "lucide-react";
import type { TraceEvent } from "@shared/types";
import { formatDuration, traceDetail, traceHeadline } from "../lib/labels";

function StageIcon({ stage }: { stage: TraceEvent["stage"] }) {
  if (stage === "model_failed") return <TriangleAlert size={14} />;
  if (stage === "model_completed" || stage === "graph_completed") return <CheckCircle2 size={14} />;
  if (stage === "dispatch") return <Send size={14} />;
  if (stage === "graph_started") return <PlayCircle size={14} />;
  return <CircleDashed size={14} />;
}

export function TracePanel({ traces, onClose }: { traces: TraceEvent[]; onClose: () => void }) {
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Run activity">
        <div className="drawer-header">
          <div>
            <h2>Run activity</h2>
            <p>Every step of the last run, in the order it happened.</p>
          </div>
          <button className="icon-button" onClick={onClose} type="button" title="Close">
            <X size={17} />
          </button>
        </div>

        <div className="drawer-body">
          {!traces.length && (
            <div className="placeholder">
              <p>Nothing to show yet. Ask a question and the steps will appear here.</p>
            </div>
          )}
          {traces.map((event) => (
            <div className="activity-item" key={event.id}>
              <div className={`activity-icon stage-${event.stage}`}>
                <StageIcon stage={event.stage} />
              </div>
              <div className="activity-content">
                <div className="activity-top">
                  <strong>{traceHeadline(event)}</strong>
                  <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                </div>
                <p>{traceDetail(event)}</p>
                {event.durationMs != null && (
                  <span className="activity-duration">took {formatDuration(event.durationMs)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
