import { ChevronDown, Copy, Info, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { ModelTarget, ProviderId, ProviderStatus } from "@shared/types";
import {
  EFFORT_LABELS,
  THINKING_LABELS,
  VENDOR_BLURB,
  VENDOR_LABELS,
  prettyModel,
  tokensToWords,
} from "../lib/labels";

interface Props {
  target: ModelTarget;
  index: number;
  models: string[];
  statuses: ProviderStatus[];
  canRemove: boolean;
  onChange: (target: ModelTarget) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onRefreshModels: () => void;
}

function optionalNumber(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function samplingRestricted(target: ModelTarget) {
  if (target.provider === "openai") return target.model.startsWith("gpt-6-astra");
  if (target.provider === "google") return /^gemini-3\.(?:5|6|7|8)/.test(target.model);
  if (target.provider === "anthropic") {
    return (
      /^claude-(?:fable|mythos)-5(?:-|$)/.test(target.model) ||
      /^claude-opus-(?:4-[78]|5)(?:-|$)/.test(target.model) ||
      /^claude-sonnet-5(?:-|$)/.test(target.model)
    );
  }
  return false;
}

function anthropicEffortSupported(model: string) {
  return (
    /^claude-(?:fable|mythos)-5(?:-|$)/.test(model) ||
    /^claude-opus-(?:4-[5-9]|5)(?:-|$)/.test(model) ||
    /^claude-sonnet-(?:4-6|5)(?:-|$)/.test(model)
  );
}

export function ModelLane({
  target,
  index,
  models,
  statuses,
  canRemove,
  onChange,
  onRemove,
  onDuplicate,
  onRefreshModels,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showFineTuning, setShowFineTuning] = useState(false);
  const panelId = useId();

  const configured = statuses.find((status) => status.id === target.provider)?.configured ?? false;
  const locksSampling = samplingRestricted(target);
  const supportsAnthropicEffort = target.provider === "anthropic" && anthropicEffortSupported(target.model);
  const showSeed = target.provider === "google" && !locksSampling;
  const showEffort = target.provider === "openai" || target.provider === "xai" || supportsAnthropicEffort;
  const showThinking = target.provider === "google" && target.model.startsWith("gemini-3");

  const patch = (next: Partial<ModelTarget>) => onChange({ ...target, ...next });
  const patchParam = (
    key: keyof ModelTarget["parameters"],
    value: ModelTarget["parameters"][keyof ModelTarget["parameters"]],
  ) => patch({ parameters: { ...target.parameters, [key]: value } });
  const patchNumber = (key: "temperature" | "topP" | "maxTokens" | "seed", value: string) =>
    patchParam(key, optionalNumber(value));

  const effortOptions: string[] = [];
  if (showEffort) {
    if (target.provider === "openai" && target.model.startsWith("gpt-5.6")) effortOptions.push("none");
    effortOptions.push("low", "medium", "high", "xhigh");
    if (target.provider !== "xai") effortOptions.push("max");
  }

  return (
    <section className={`model-card ${target.enabled ? "is-on" : "is-off"} ${open ? "is-open" : ""}`}>
      <div className="model-row">
        <label className="toggle" title={target.enabled ? "Included in the comparison" : "Skipped"}>
          <input
            type="checkbox"
            checked={target.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          <span className="toggle-track" aria-hidden="true" />
          <span className="visually-hidden">Include {VENDOR_LABELS[target.provider]} in the comparison</span>
        </label>

        <span className={`vendor-badge vendor-${target.provider}`} aria-hidden="true">
          {VENDOR_LABELS[target.provider].charAt(0)}
        </span>

        <div className="model-identity">
          <strong>{prettyModel(target.model)}</strong>
          <span>
            {VENDOR_LABELS[target.provider]}
            <i className="dot-sep" />
            Model {index + 1}
          </span>
        </div>

        {!configured && (
          <span className="key-warning" title="No API key is set for this vendor, so this model will report an error.">
            Key missing
          </span>
        )}

        <button
          type="button"
          className="disclosure"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontal size={14} />
          Settings
          <ChevronDown size={14} className="chevron" />
        </button>
      </div>

      {open && (
        <div className="model-settings" id={panelId}>
          <div className="field-grid">
            <label className="field">
              <span className="field-label">AI vendor</span>
              <select
                value={target.provider}
                onChange={(event) => patch({ provider: event.target.value as ProviderId, model: "" })}
              >
                {(Object.keys(VENDOR_LABELS) as ProviderId[]).map((provider) => (
                  <option key={provider} value={provider}>
                    {VENDOR_LABELS[provider]}
                  </option>
                ))}
              </select>
              <span className="field-hint">{VENDOR_BLURB[target.provider]}</span>
            </label>

            <label className="field">
              <span className="field-label">Model version</span>
              <div className="input-with-action">
                <input
                  list={`models-${target.id}`}
                  value={target.model}
                  placeholder="Start typing, or pick from the list"
                  onChange={(event) => patch({ model: event.target.value })}
                />
                <button
                  className="icon-button"
                  onClick={onRefreshModels}
                  title="Refresh the list of available models from this vendor"
                  type="button"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
              <datalist id={`models-${target.id}`}>
                {models.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              <span className="field-hint">You can type any version this vendor offers, even if it is not listed.</span>
            </label>

            <label className="field">
              <span className="field-label">Answer length limit</span>
              <input
                type="number"
                min="1"
                step="128"
                placeholder="Vendor default"
                value={target.parameters.maxTokens ?? ""}
                onChange={(event) => patchNumber("maxTokens", event.target.value)}
              />
              <span className="field-hint">
                {target.parameters.maxTokens
                  ? `Caps each answer at ${tokensToWords(target.parameters.maxTokens)}.`
                  : "Leave blank to let the vendor decide."}
              </span>
            </label>

            {showEffort && (
              <label className="field">
                <span className="field-label">How hard it thinks</span>
                <select
                  value={target.parameters.reasoningEffort ?? ""}
                  onChange={(event) =>
                    patchParam(
                      "reasoningEffort",
                      (event.target.value || undefined) as ModelTarget["parameters"]["reasoningEffort"],
                    )
                  }
                >
                  <option value="">Vendor default</option>
                  {effortOptions.map((option) => (
                    <option key={option} value={option}>
                      {EFFORT_LABELS[option] ?? option}
                    </option>
                  ))}
                </select>
                <span className="field-hint">More thinking usually means better answers, but slower and costlier.</span>
              </label>
            )}

            {showThinking && (
              <label className="field">
                <span className="field-label">How hard it thinks</span>
                <select
                  value={target.parameters.thinkingLevel ?? ""}
                  onChange={(event) =>
                    patchParam(
                      "thinkingLevel",
                      (event.target.value || undefined) as ModelTarget["parameters"]["thinkingLevel"],
                    )
                  }
                >
                  <option value="">Vendor default</option>
                  {(["low", "medium", "high"] as const).map((option) => (
                    <option key={option} value={option}>
                      {THINKING_LABELS[option]}
                    </option>
                  ))}
                </select>
                <span className="field-hint">More thinking usually means better answers, but slower and costlier.</span>
              </label>
            )}
          </div>

          {locksSampling ? (
            <p className="capability-note">
              <Info size={14} />
              This model version sets its own creativity controls, so we leave them out of the request instead of
              sending settings it would reject.
            </p>
          ) : (
            <div className="fine-tuning">
              <button type="button" className="link-button" onClick={() => setShowFineTuning((value) => !value)}>
                {showFineTuning ? "Hide" : "Show"} fine-tuning controls
              </button>
              {showFineTuning && (
                <div className="field-grid">
                  <label className="field">
                    <span className="field-label">Creativity</span>
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      placeholder="Vendor default"
                      value={target.parameters.temperature ?? ""}
                      onChange={(event) => patchNumber("temperature", event.target.value)}
                    />
                    <span className="field-hint">0 is repetitive and literal. 2 is loose and surprising.</span>
                  </label>

                  <label className="field">
                    <span className="field-label">Word variety</span>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      placeholder="Vendor default"
                      value={target.parameters.topP ?? ""}
                      onChange={(event) => patchNumber("topP", event.target.value)}
                    />
                    <span className="field-hint">Narrows how many word choices the model considers.</span>
                  </label>

                  {showSeed && (
                    <label className="field">
                      <span className="field-label">Repeat code</span>
                      <input
                        type="number"
                        step="1"
                        placeholder="Vendor default"
                        value={target.parameters.seed ?? ""}
                        onChange={(event) => patchNumber("seed", event.target.value)}
                      />
                      <span className="field-hint">Reuse the same number to get the same answer again.</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="model-card-actions">
            <button type="button" className="link-button" onClick={onDuplicate}>
              <Copy size={13} /> Duplicate this model
            </button>
            {canRemove && (
              <button type="button" className="link-button danger" onClick={onRemove}>
                <Trash2 size={13} /> Remove
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
