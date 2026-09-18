import { Check, ChevronDown, Clock, Copy, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ModelResult, ModelTarget } from "@shared/types";
import {
  VENDOR_LABELS,
  describeParameters,
  finishLabel,
  formatDuration,
  prettyModel,
} from "../lib/labels";

interface Props {
  target: ModelTarget;
  result?: ModelResult;
  running: boolean;
  fastest?: boolean;
}

export function ResultCard({ target, result, running, fastest }: Props) {
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const pending = running && !result;
  const status = result ? finishLabel(result.finishReason, Boolean(result.error)) : undefined;

  const copy = async () => {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <article className={`answer-card ${result?.error ? "has-error" : ""}`}>
      <header className="answer-header">
        <span className={`vendor-badge vendor-${target.provider}`} aria-hidden="true">
          {VENDOR_LABELS[target.provider].charAt(0)}
        </span>
        <div className="answer-identity">
          <strong>{prettyModel(target.model)}</strong>
          <span>{VENDOR_LABELS[target.provider]}</span>
        </div>
        {result?.text && (
          <button type="button" className="icon-button" onClick={copy} title="Copy this answer">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
      </header>

      <div className="answer-stats">
        {pending && (
          <span className="stat pending">
            <LoaderCircle className="spin" size={12} /> Working
          </span>
        )}
        {result && (
          <>
            <span className="stat">
              <Clock size={12} />
              {formatDuration(result.latencyMs)}
            </span>
            {fastest && !result.error && <span className="stat highlight">Fastest</span>}
            {result.usage?.totalTokens != null && (
              <span className="stat">{result.usage.totalTokens.toLocaleString()} tokens</span>
            )}
            {status && <span className={`stat tone-${status.tone}`}>{status.text}</span>}
          </>
        )}
        {!pending && !result && <span className="stat muted">Not run yet</span>}
      </div>

      <div className="answer-body">
        {pending && (
          <div className="placeholder active">
            <LoaderCircle className="spin" size={18} />
            <p>Waiting for {VENDOR_LABELS[target.provider]} to answer…</p>
          </div>
        )}
        {!pending && !result && (
          <div className="placeholder">
            <p>This model's answer will appear here.</p>
          </div>
        )}
        {result?.error && (
          <div className="error-box">
            <TriangleAlert size={16} />
            <div>
              <strong>This model could not answer</strong>
              <p>{result.error}</p>
            </div>
          </div>
        )}
        {result?.text && (
          <div className="markdown-output">
            <ReactMarkdown>{result.text}</ReactMarkdown>
          </div>
        )}
      </div>

      <footer className="answer-footer">
        <button
          type="button"
          className="link-button subtle"
          aria-expanded={showSettings}
          onClick={() => setShowSettings((value) => !value)}
        >
          Settings used
          <ChevronDown size={13} className={showSettings ? "chevron open" : "chevron"} />
        </button>
        {showSettings && (
          <dl className="settings-readout">
            <div>
              <dt>Exact model</dt>
              <dd>{target.model || "none"}</dd>
            </div>
            <div>
              <dt>Sent settings</dt>
              <dd>{describeParameters(result?.parameters ?? target.parameters)}</dd>
            </div>
            {result?.usage && (
              <div>
                <dt>Tokens in / out</dt>
                <dd>
                  {(result.usage.inputTokens ?? 0).toLocaleString()} / {(result.usage.outputTokens ?? 0).toLocaleString()}
                </dd>
              </div>
            )}
            {result?.rawRequestId && (
              <div>
                <dt>Vendor request ID</dt>
                <dd className="mono">{result.rawRequestId}</dd>
              </div>
            )}
          </dl>
        )}
      </footer>
    </article>
  );
}
