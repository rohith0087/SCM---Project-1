import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { ExperimentSpec, StudyAttachment } from "../../shared/experiment.js";
import { validateSpec } from "./schema.js";
import { saveAsset, extractDocument, readAsset } from "./assets.js";
import { saveRevision, revisions, readRevision } from "./projects.js";
import { buildConditions, planRuns } from "./design.js";
import { RunStore } from "./store.js";
import { BatchService } from "./service.js";
import { runExperiment } from "./runner.js";
import { batchPackage } from "./package.js";
import { parseMeasures } from "./parse.js";
import { openAIInput } from "../providers/base.js";
const spec = (): ExperimentSpec => ({id:"custom",version:"1",title:"Custom protocol",factors:[],models:[{id:"test",provider:"openai",model:"offline-test",parameters:{maxTokens:128}}],replicates:1,systemPrompt:"Exact system.",userPromptTemplate:"Exact user.\nSecond line.",measures:[],responseMode:"text",concurrency:{global:1},retry:{maxAttempts:2,baseDelayMs:100},limits:{timeoutMs:1000,maxTotalCalls:10}});
async function temporary(fn:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(os.tmpdir(),"scm-workspace-"));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}

test("custom protocols preserve wording, validate categories, and reject ambiguous mappings",()=>{
  const s=spec();assert.equal(buildConditions(validateSpec(s))[0].userPrompt,s.userPromptTemplate);
  s.factors=[{id:"person",label:"Person",levels:[{id:"a",label:"A",vars:{name:"Alex"}},{id:"b",label:"B",vars:{name:"Blair"}}]}];s.userPromptTemplate="Read {{name}}.";
  assert.deepEqual(buildConditions(validateSpec(s)).map(c=>c.userPrompt),["Read Alex.","Read Blair."]);
  assert.throws(()=>validateSpec({...s,stimulusRules:[{when:{},vars:{x:"one"}},{when:{},vars:{x:"two"}}]}),/overlap|Multiple|same|conflict/i);
  assert.throws(()=>validateSpec({...s,userPromptTemplate:"{{missing}}"}),/Unresolved/);
  const fields=[{id:"decision",label:"Decision",type:"text" as const,required:true,allowedValues:["retain","dismiss"]}];
  assert.equal(parseMeasures('{"decision":"retain"}',fields).status,"ok");
  assert.equal(parseMeasures('{"decision":"other"}',fields).status,"partial");
  assert.notEqual(parseMeasures('{"decision":{}}',fields).status,"ok");
});

test("DOCX extraction preserves text and warns about layout",async()=>{
  const bytes=zipSync({"[Content_Types].xml":strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),"word/document.xml":strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Professor supplied wording.</w:t></w:r></w:p></w:body></w:document>')});
  const result=await extractDocument("protocol.docx",Buffer.from(bytes));assert.match(result.extractedText,/Professor supplied wording\./);assert.ok(result.warnings.length);
});

test("text PDF extraction works in the Node server",async()=>{
  const content="BT /F1 12 Tf 50 700 Td (Exact PDF scenario.) Tj ET";
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf="%PDF-1.4\n";const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,"0")+" 00000 n \n").join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  assert.match((await extractDocument("scenario.pdf",Buffer.from(pdf))).extractedText,/Exact PDF scenario/);
});

test("attachments are reviewed, condition-mapped, frozen, and included in archives",async()=>temporary(async root=>{
  const assets=path.join(root,"assets"),batches=path.join(root,"batches");
  const reference=await saveAsset("protocol.txt",Buffer.from("Never send this protocol"),assets);
  const stimulus=await saveAsset("scenario.txt",Buffer.from("Original situation"),assets);
  const s=spec();s.factors=[{id:"group",label:"Group",levels:[{id:"a",label:"A"},{id:"b",label:"B"}]}];
  s.attachments=[{...reference,role:"reference",reviewed:true,reviewedText:reference.extractedText,when:{}},{...stimulus,role:"stimulus",reviewed:true,reviewedText:"Reviewed situation",when:{group:"a"}}];
  const conditions=buildConditions(s);assert.match(conditions[0].userPrompt,/Reviewed situation/);assert.ok(!conditions[1].userPrompt.includes("situation"));assert.ok(conditions.every(c=>!c.userPrompt.includes("Never send")));
  await assert.rejects(()=>RunStore.create({...s,attachments:s.attachments!.map(a=>({...a,reviewed:false}))},"demo",batches,assets),/Review/);
  const store=await RunStore.create(s,"demo",batches,assets);const files=unzipSync(await batchPackage(store));
  assert.equal(strFromU8(files[`attachments/${stimulus.id}`]),"Original situation");assert.ok(files["study-spec.json"]);assert.ok(!Object.keys(files).some(k=>k.includes(".env")));
  await writeFile(path.join(assets,stimulus.id,"original"),"Changed source");await assert.rejects(()=>readAsset(stimulus.id,assets),/integrity/);
  assert.equal(strFromU8(unzipSync(await batchPackage(store))[`attachments/${stimulus.id}`]),"Original situation");
}));

test("study revisions preserve history and reject concurrent stale saves",async()=>temporary(async root=>{
  const first=await saveRevision(spec(),randomUUID(),undefined,root);
  const changed={...first.spec,userPromptTemplate:"Revised by researcher."};
  const second=await saveRevision(changed,first.projectId,first.revisionId,root);
  await assert.rejects(()=>saveRevision(changed,first.projectId,first.revisionId,root),/newer revision/);
  assert.equal((await readRevision(first.projectId,first.revisionId,root)).spec.userPromptTemplate,spec().userPromptTemplate);
  assert.equal((await revisions(first.projectId,root)).length,2);assert.notEqual(first.revisionId,second.revisionId);
}));

test("call cap persists across service restart without sending extra requests",async()=>temporary(async root=>{
  const s=spec();s.replicates=3;s.limits!.maxTotalCalls=1;
  const store=await RunStore.create(s,"demo",root);const service=new BatchService(root);
  await service.start(store.manifest.batchId);await service.wait(store.manifest.batchId);
  const view=await service.view(store.manifest.batchId);assert.equal(view.state,"error");assert.equal(view.completed,1);assert.equal(view.attempts,1);
  const restarted=new BatchService(root);assert.match((await restarted.view(store.manifest.batchId)).error!,/CALL_LIMIT/);
  await restarted.start(store.manifest.batchId);await restarted.wait(store.manifest.batchId);
  assert.equal((await restarted.view(store.manifest.batchId)).attempts,1);
}));

test("offline transport retry uses fresh context, bounded timeout, and durable attempts",async()=>temporary(async root=>{
  const s=spec(),store=await RunStore.create(s,"live",root);let calls=0;
  await runExperiment({spec:s,store,runs:planRuns(s),adapter:async input=>{calls++;assert.deepEqual(input.messages,[{role:"user",content:s.userPromptTemplate}]);assert.equal(input.systemPrompt,s.systemPrompt);assert.ok(input.signal);if(calls===1)throw new Error("429 overloaded");return {text:"Exact answer",reportedModel:"offline-version"};}});
  assert.equal(calls,2);const reopened=await RunStore.openBatch(store.manifest.batchId,root);assert.equal(reopened.attempts,2);assert.equal((await reopened.readAll())[0].attempt,2);assert.equal((await reopened.readAll())[0].parseStatus,"ok");
}));

test("pause preserves a failed in-flight request without automatic retry",async()=>temporary(async root=>{
  const s=spec(),store=await RunStore.create(s,"live",root),controller=new AbortController();let calls=0;
  const result=await runExperiment({spec:s,store,runs:planRuns(s),signal:controller.signal,adapter:async()=>{calls++;controller.abort();throw new Error("503 unavailable");}});
  assert.equal(result.state,"paused");assert.equal(calls,1);assert.match((await store.readAll())[0].error!,/503/);
}));

test("native image bytes are frozen and passed to the transport",async()=>temporary(async root=>{
  const image=await saveAsset("stimulus.png",Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=","base64"),path.join(root,"assets"));
  const s=spec();s.attachments=[{...image,role:"stimulus",when:{},reviewed:true,reviewedText:""} satisfies StudyAttachment];
  const store=await RunStore.create(s,"live",path.join(root,"batches"),path.join(root,"assets"));
  await runExperiment({spec:s,store,runs:planRuns(s),adapter:async input=>{assert.equal(input.images?.length,1);assert.equal(input.images[0].mime,"image/png");const payload=openAIInput(input.messages,input.images);assert.match(JSON.stringify(payload),/data:image\/png;base64/);return {text:"Image received"};}});
  await writeFile(path.join(store.dir,"attachments",image.id),"tampered");await assert.rejects(()=>store.image(image.id),/integrity/);
}));

test("attempt-ledger failures stop scheduling before a provider is called",async()=>temporary(async root=>{
  const s=spec(),store=await RunStore.create(s,"live",root);let called=false;
  store.reserveAttempt=async()=>{throw new Error("disk unavailable");};
  await assert.rejects(()=>runExperiment({spec:s,store,runs:planRuns(s),adapter:async()=>{called=true;return {text:"unexpected"};}}),/disk unavailable/);
  assert.equal(called,false);assert.equal((await store.readAll()).length,0);
}));
