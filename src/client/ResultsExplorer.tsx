import { useEffect, useState } from "react";
import type { RunRecord, ExperimentModel } from "../shared/experiment";
import { researchApi as api } from "./researchApi";
export default function ResultsExplorer({id,models,completed}:{id:string;models:ExperimentModel[];completed:number}){
  const [status,setStatus]=useState("all"),[model,setModel]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(1);
  const [data,setData]=useState<{total:number;records:RunRecord[]}>(),[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{void api<{total:number;records:RunRecord[]}>(`/batches/${id}/records?${new URLSearchParams({status,model,search,page:String(page)})}`).then(v=>{if(!cancelled){setData(v);setError("");}}).catch(e=>{if(!cancelled)setError(e.message);});},200);return()=>{cancelled=true;clearTimeout(timer);};},[id,status,model,search,page,completed]);
  return <section className="experiment-card response-review"><h2>Response explorer</h2><p>Review every recorded answer, including flagged responses and API failures. Filters do not remove records from exports.</p><div className="selector-grid"><label>Response status<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{["all","ok","partial","invalid","missing","refused","error"].map(s=><option key={s}>{s}</option>)}</select></label><label>Model lane<select value={model} onChange={e=>{setModel(e.target.value);setPage(1);}}><option value="">All models</option>{models.map(m=><option key={m.id}>{m.id}</option>)}</select></label><label>Search conditions or response text<input value={search} maxLength={200} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label></div>
    {error&&<p role="alert">{error}</p>}<p className="experiment-muted">{data?.total??0} matching responses · page {page}</p>
    {data?.records.map(r=><details key={r.runKey}><summary>{r.modelId} · repetition {r.replicate} · {r.error?"API error":r.parseStatus} · {r.conditionId||"Single prompt"}</summary><p>{r.parseNotes??r.error}</p><pre>{r.rawText||"No response body"}</pre><details><summary>Parsed fields, timing, usage & provenance</summary><pre>{JSON.stringify({...r,rawText:undefined},null,2)}</pre></details></details>)}
    <div className="experiment-actions"><button className="ghost-button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous page</button><button className="ghost-button" disabled={!data||page*25>=data.total} onClick={()=>setPage(p=>p+1)}>Next page</button></div>
  </section>;
}
