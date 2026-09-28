import { useEffect, useState } from "react";
import { ArrowLeft, FlaskConical, Play, Pause, Download, RefreshCw } from "lucide-react";
import type { Manifest } from "../server/experiment/store";
import type { BatchService } from "../server/experiment/service";
import { researchApi as api } from "./researchApi";
import StudyBuilder from "./StudyBuilder";
import Connections from "./Connections";
import ResultsExplorer from "./ResultsExplorer";
type BatchView = Awaited<ReturnType<BatchService["view"]>>;
export default function ExperimentWorkspace() {
  const [serverDemo,setServerDemo]=useState(true);
  const [batches,setBatches]=useState<Manifest[]>([]);
  const [activeId,setActiveId]=useState<string>();
  const [batch,setBatch]=useState<BatchView>();
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [tab,setTab]=useState<"study"|"connections"|"batches">("study");
  const refreshBatches=async()=>setBatches(await api<Manifest[]>("/batches"));
  useEffect(()=>{void refreshBatches().catch(e=>setError(e.message));void api<{demoMode:boolean}>("/connections").then(s=>setServerDemo(s.demoMode)).catch(e=>setError(e.message));},[]);
  useEffect(()=>{
    if(!activeId)return;
    let cancelled=false;let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{try{const result=await api<BatchView>(`/batches/${activeId}`);if(!cancelled)setBatch(result);}catch(e){if(!cancelled)setError((e as Error).message);}if(!cancelled)timer=setTimeout(refresh,1500);};
    void refresh();return()=>{cancelled=true;clearTimeout(timer);};
  },[activeId]);
  async function action(task:()=>Promise<void>){setBusy(true);setError("");try{await task();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const running=batch?.state==="running"||batch?.state==="pausing";
  return <div className="experiment-shell">
    <aside className="experiment-sidebar">
      <a className="back-link" href="#compare"><ArrowLeft size={16}/>Optional comparison chat</a>
      <div className="experiment-brand"><FlaskConical size={23}/><div><strong>Research workspace</strong><span>Study 2 infrastructure</span></div></div>
      {([["study","Study setup"],["connections","Connections"],["batches","Saved batches"]] as const).map(([id,label])=><button key={id} className={tab===id?"experiment-nav selected":"experiment-nav"} onClick={()=>setTab(id)}>{label}{id==="batches"&&<span>{batches.length}</span>}</button>)}
      <div className="experiment-side-note"><strong>Your protocol. Your materials.</strong><p>Attach approved documents, configure exact prompts, review conditions, then run.</p><p>Each batch preserves its study revision and original materials.</p></div>
    </aside>
    <main className="experiment-main">
      <header className="experiment-heading"><div><p className="eyebrow">RESEARCH PIPELINE</p><h1>{tab==="study"?"Prepare your study." : tab==="connections"?"Connect your models." : "Collection & quality review"}</h1><p>{tab==="study"?"A reproducible workflow for researcher-supplied prompts and materials.":tab==="connections"?"Configure provider access and verify exact model IDs.":"Monitor, resume, inspect, and export saved batches."}</p></div><span className="mode-badge">{serverDemo?"Server in demo mode":"Live execution enabled"}</span></header>
      {error&&<div role="alert" className="notice error">{error}</div>}
      <div hidden={tab!=="study"}><StudyBuilder onBatch={id=>{setActiveId(id);setBatch(undefined);setConfirmed(false);setTab("batches");void refreshBatches().catch(e=>setError(e.message));}}/></div>
      {tab==="connections"&&<Connections onMode={setServerDemo}/>}
      {tab==="batches"&&<>
        <section className="experiment-card">
          <div className="experiment-section-title"><div><h2>Saved batches</h2><p>Each entry preserves the study wording, model selection, and repetition count used for that batch.</p></div><button className="ghost-button" aria-label="Refresh batches" onClick={() => void action(refreshBatches)}><RefreshCw size={15} /></button></div>
          {batches.length === 0 ? <p>No batches yet. Create one from Study setup.</p> : <div className="batch-list">{batches.map(b => <button className={activeId === b.batchId ? "batch-item selected" : "batch-item"} key={b.batchId} onClick={() => { setActiveId(b.batchId); setBatch(undefined); setConfirmed(false); }}><span><strong>{b.spec.title} · {b.mode.toUpperCase()} · {b.plannedRuns.toLocaleString()} calls</strong><small>{new Date(b.createdAt).toLocaleString()} · {b.spec.models.map(m => m.model).join(", ")}</small></span><code>{b.batchId.slice(0, 8)}</code></button>)}</div>}
        </section>
        {batch && <section className="experiment-card">
          <div className="experiment-section-title"><div><p className="eyebrow">{batch.manifest.mode.toUpperCase()} BATCH · {batch.manifest.batchId.slice(0, 8)}</p><h2>{batch.state === "done" ? "Batch finished" : `Batch ${batch.state}`}</h2></div><span className="mode-badge">v{batch.manifest.experimentVersion}</span></div>
          {batch.manifest.mode === "demo" && <div className="notice">Synthetic fixtures only. These ratings test the pipeline and must not be analyzed as model judgments.</div>}
          {batch.manifest.experimentId === "study2-driver-bias" && batch.manifest.spec.measures.some(m => m.id === "operational_risk") && <div className="notice warn">Earlier seven-rating configuration. The Word document’s Study 2 template specifies six ratings plus reasoning. Create a new batch from the corrected preset to use that template. This saved batch retains its original settings.</div>}
          {batch.error && <div role="alert" className="notice error">{batch.error}</div>}
          <div className="experiment-metrics"><div><strong>{batch.completed} / {batch.manifest.plannedRuns}</strong><span>recorded calls · {batch.attempts} attempts used</span></div><div><strong>{batch.valid}</strong><span>valid responses</span></div><div><strong>{batch.flagged}</strong><span>responses to review</span></div><div><strong>{batch.failed}</strong><span>API errors</span></div></div>
          <progress aria-label="Batch completion" value={batch.completed} max={batch.manifest.plannedRuns} />
          <details className="frozen-settings"><summary>Frozen models & settings</summary><pre>{JSON.stringify({ models: batch.manifest.spec.models, replicates: batch.manifest.spec.replicates, seed: batch.manifest.spec.seed, fingerprint: batch.manifest.fingerprint }, null, 2)}</pre></details>
          {batch.manifest.mode === "live" && !running && <label className="check-label"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I reviewed these model IDs, parameters, and the API budget and authorize this live batch.</label>}
          <div className="experiment-actions">
            {running ? <button className="ghost-button" disabled={busy || batch.state === "pausing"} onClick={() => void action(async () => { await api(`/batches/${activeId}/pause`, {}); setBatch(await api(`/batches/${activeId}`)); })}><Pause size={15} />{batch.state === "pausing" ? "Saving in-flight calls…" : "Pause"}</button>
              : <button className="primary-button" disabled={busy || batch.completed >= batch.manifest.plannedRuns || (batch.manifest.mode === "live" && (!confirmed || serverDemo))} onClick={() => void action(async () => { setBatch(await api(`/batches/${activeId}/start`, { confirmed })); })}><Play size={15} />{batch.completed ? "Resume" : "Start"} {batch.manifest.mode} batch</button>}
            {!running && batch.failed > 0 && <button className="ghost-button" disabled={busy || (batch.manifest.mode === "live" && (!confirmed || serverDemo))} onClick={() => void action(async () => { setBatch(await api(`/batches/${activeId}/start`, { confirmed, retryFailed: true })); })}>Retry API errors</button>}
            {!running && <a className="ghost-button" href={`/api/batches/${batch.manifest.batchId}/export/results`}><Download size={14} />Download results (CSV)</a>}
          </div>
          {!running && <details className="completion-details"><summary>Advanced downloads</summary><p className="experiment-muted">Optional supporting records. Results above contain the answers for analysis.</p><div className="experiment-actions">{[["package", "Complete archive (ZIP)"], ["conditions", "Conditions & prompts (CSV)"], ["completion", "Coverage report (CSV)"], ["manifest", "Batch settings (JSON)"]].map(([kind,label]) => <a className="ghost-button" key={kind} href={`/api/batches/${batch.manifest.batchId}/export/${kind}`}><Download size={14} />{label}</a>)}</div></details>}
          {batch.manifest.mode === "live" && serverDemo && <p className="experiment-muted">Live execution is disabled while the server is in demo mode.</p>}
          <p className="experiment-muted">Flagged responses and possible refusals remain in the dataset. Only API errors can be explicitly retried. “Finished” means all planned calls have records; it does not mean all responses are valid.</p>
          <details open className="completion-details"><summary>Coverage by condition and model</summary><div className="experiment-table-wrap"><table><thead><tr><th>Condition</th><th>Model</th><th>Expected</th><th>Valid</th><th>Flagged</th><th>Possible refusals</th><th>Errors</th></tr></thead><tbody>{batch.rows.map(row => <tr key={`${row.conditionId}-${row.modelId}`}><td>{row.conditionId.replaceAll("|", " · ")}</td><td>{row.modelId}</td><td>{row.expected}</td><td>{row.ok}</td><td>{row.partial + row.invalid + row.missing}</td><td>{row.refused}</td><td>{row.failed}</td></tr>)}</tbody></table></div></details>

        </section>}

        {batch && <ResultsExplorer key={batch.manifest.batchId} id={batch.manifest.batchId} models={batch.manifest.spec.models} completed={batch.completed} />}
      </>}
    </main>
  </div>;
}
