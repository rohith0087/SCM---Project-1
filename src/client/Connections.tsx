import { useEffect, useState } from "react";
import { researchApi as api } from "./researchApi";
type Status = { demoMode: boolean; providers: { id: string; variable: string; configured: boolean }[] };
export default function Connections({ onMode }: { onMode: (demo: boolean) => void }) {
  const [status,setStatus]=useState<Status>();
  const [keys,setKeys]=useState<Record<string,string>>({});
  const [persist,setPersist]=useState(false);
  const [models,setModels]=useState<Record<string,string>>({});
  const [confirmed,setConfirmed]=useState<Record<string,boolean>>({});
  const [results,setResults]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function refresh(){ const s=await api<Status>("/connections");setStatus(s);onMode(s.demoMode); }
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[]);
  async function work(task:()=>Promise<void>){setBusy(true);setError("");try{await task();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <section className="experiment-card"><h2>Provider connections</h2><p>Keys are used by this local server. They are never included in study exports or browser storage.</p>
      <div className="builder-toolbar"><span className="mode-badge">{status?.demoMode?"Demo mode":"Live mode"}</span><button className="ghost-button" disabled={busy||!status} onClick={()=>void work(async()=>{await api("/connections/mode",{demoMode:!status!.demoMode});})}>{status?.demoMode?"Enable live execution":"Switch to demo mode"}</button></div>
      <p className="experiment-muted">Changing mode does not start or cancel a batch. Pause any running batch before changing connections. Demo batches always use synthetic responses.</p>
      <label className="check-label"><input type="checkbox" checked={persist} onChange={e=>setPersist(e.target.checked)}/>Save newly entered keys in this installation’s ignored .env file. Otherwise keep them only for this server session.</label>
    </section>
    {status?.providers.map(p=><section className="experiment-card" key={p.id}><div className="experiment-section-title"><h2>{p.id}</h2><span className="mode-badge">{p.configured?"Key configured":"Key needed"}</span></div>
      <div className="builder-toolbar"><label>API key for {p.id}<input type="password" autoComplete="off" value={keys[p.id]??""} onChange={e=>setKeys(v=>({...v,[p.id]:e.target.value}))}/></label><button className="primary-button" disabled={busy||!keys[p.id]} onClick={()=>void work(async()=>{await api(`/connections/${p.id}/key`,{key:keys[p.id],persist});setKeys(v=>({...v,[p.id]:""}));setResults(v=>({...v,[p.id]:"Key saved. Check access next."}));})}>Save key</button><button className="ghost-button" disabled={busy||!p.configured} onClick={()=>void work(async()=>{const result=await api(`/connections/${p.id}/check`,{});setResults(v=>({...v,[p.id]:JSON.stringify(result,null,2)}));})}>Check catalog access</button></div>
      <details><summary>Optional generation test · one potentially paid call</summary><p>Checks text generation for the exact model ID below using “Reply with the single word OK.” Image support should be checked with your own small pilot.</p><label>Test model ID<input value={models[p.id]??""} onChange={e=>{setModels(v=>({...v,[p.id]:e.target.value}));setConfirmed(v=>({...v,[p.id]:false}));}}/></label><label className="check-label"><input type="checkbox" checked={confirmed[p.id]??false} onChange={e=>setConfirmed(v=>({...v,[p.id]:e.target.checked}))}/>Authorize this one-call generation test.</label><button className="ghost-button" disabled={busy||status.demoMode||!p.configured||!models[p.id]||!confirmed[p.id]} onClick={()=>void work(async()=>{const result=await api(`/connections/${p.id}/probe`,{confirmed:true,model:{id:"probe",provider:p.id,model:models[p.id],parameters:{maxTokens:128}}});setConfirmed(v=>({...v,[p.id]:false}));setResults(v=>({...v,[p.id]:JSON.stringify(result,null,2)}));})}>Run generation test</button></details>
      {results[p.id]&&<pre className="connection-result">{results[p.id]}</pre>}
    </section>)}
  </>;
}
