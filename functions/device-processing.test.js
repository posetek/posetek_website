"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict"),{createHash}=require("node:crypto");
const {normalizeManifest,createDiagnosticPerformance,createDeviceProcessingReports,summarize,currentRun,ROOT,INVENTORY,BUCKET,CURRENT}=require("./device-processing");
const {FakeFirestore,FieldValue,HttpsError}=require("./test-support/device-performance/fake-firestore");
const at=Date.parse("2026-10-02T18:00:00Z"), admin={uid:"admin",email:"admin@posetek.net",emailVerified:true,isAnonymous:false};
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(n=1){
  const attemptId=uid(n),runId=uid(n+10000),installId=uid(9000),path=`processing_attempts/reporter/${attemptId}/manifest.json`;
  return {path,index:{schemaVersion:2,attemptId,manifestPath:path,reportedByUid:"reporter",playerDocumentID:"player",drillType:"sprint"},
    manifest:{schemaVersion:1,sequence:2,drill:"sprint",identity:{schemaVersion:1,attemptId,reporterUID:"reporter",athleteDocumentID:"player",originInstallId:installId,originLaunchId:"launch",createdAt:at+n},
      capture:{appVersion:"1.1",build:"31",sessionNumber:1,sessionDocId:"session",requestedFPS:120,measuredMedia:{durationSeconds:6,uprightDimensions:[1280,720]},platform:{configuration:"Release",machine:"iPhone18,3",sourceRevision:CURRENT.sourceRevisions[0]}},
      runs:{[runId]:{identity:{attemptId,processingRunId:runId,executorInstallId:installId,launchId:"launch",mode:"liveCapture"},startedAt:at+n,terminalAt:at+n+11000,outcome:{prepared:{status:"valid"}},
        execution:{samplingSchedule:CURRENT.sampling.sprint,policyHash:"policy"},performance:{runId,attemptId,processingMs:10000,sampledPeakBytes:300*1048576,lowPowerModeEnabled:false},
        stageSummaries:[{stageId:"sprint.extract",timingKind:"mainPhase",elapsedMs:9900,framesDecoded:1000,modelCalls:300},{stageId:"model.firstPrediction",parentStageId:"sprint.extract",timingKind:"nestedOperation",elapsedMs:100,modelCalls:1}]}}}};
}
function summary(n=1){const f=fixture(n);return normalizeManifest(f.manifest,f.index,{path:f.path,generation:String(n),receivedAt:at+1000000});}
test("existing diagnostics normalize without counting nested calls twice",()=>{
 const r=summary().runs[0];assert.equal(r.modelCalls,300);assert.equal(r.framesDecoded,1000);assert.equal(r.processingMs,10000);assert.equal(r.wallMs,11000);assert.equal(r.lowPower,false);assert.equal(currentRun(r),true);
});
test("old wall timing stays separate; missing memory is not zero",()=>{
 const f=fixture();delete Object.values(f.manifest.runs)[0].performance;const r=normalizeManifest(f.manifest,f.index,{path:f.path,generation:"1",receivedAt:at+20000}).runs[0];
 assert.equal(r.processingMs,null);assert.equal(r.timingKind,"runWall");assert.equal(r.sampledPeakBytes,null);assert.equal(summarize([r,summary().runs[0]]).length,2);
});
test("same numerical build with a different source is a different cohort",()=>{
 const r=summary().runs[0], f=fixture(2);f.manifest.capture.platform.sourceRevision="older";
 const old=normalizeManifest(f.manifest,f.index,{path:f.path,generation:"2",receivedAt:at+20000}).runs[0];
 assert.equal(currentRun(old),false);assert.notEqual(r.algorithmId,old.algorithmId);assert.equal(summarize([r,old]).length,2);
});
test("unsuccessful runs remain counted but cannot make success averages faster",()=>{
 const r=summary().runs[0];const c=summarize([r,{...r,runId:uid(333),durationMs:100,outcome:"failed"},{...r,runId:uid(334),durationMs:200,outcome:"partial"}])[0];
 assert.equal(c.duration.mean,10000);assert.equal(c.duration.count,1);assert.equal(c.failed,1);assert.equal(c.partial,1);assert.equal(c.count,3);
});
test("sessions do not collide across athletes; model does not imply device identity",()=>{
 const a=summary(),f=fixture(2);f.index.playerDocumentID=f.manifest.identity.athleteDocumentID="another-player";delete f.manifest.identity.originInstallId;delete Object.values(f.manifest.runs)[0].identity.executorInstallId;
 const b=normalizeManifest(f.manifest,f.index,{path:f.path,generation:"2",receivedAt:at+20000});assert.notEqual(a.sessionId,b.sessionId);assert.equal(b.runs[0].installId,null);
});
test("recording phone is not attributed to a retry from an unknown execution install",()=>{
 const f=fixture();delete Object.values(f.manifest.runs)[0].identity.executorInstallId;Object.values(f.manifest.runs)[0].identity.launchId="other";
 const b=normalizeManifest(f.manifest,f.index,{path:f.path,generation:"1",receivedAt:at+20000});assert.equal(b.runs[0].installId,null);assert.equal(b.runs[0].machine,null);
});
test("rejects forged reporter, attempt, athlete, drill, performance run and oversized stage lists",()=>{
 for(const change of [f=>f.manifest.identity.reporterUID="other",f=>f.index.attemptId=uid(99),f=>f.manifest.identity.athleteDocumentID="other",f=>f.manifest.drill="jump",f=>Object.values(f.manifest.runs)[0].performance.runId=uid(99),f=>Object.values(f.manifest.runs)[0].stageSummaries=Array(49).fill({})]){
  const f=fixture();change(f);assert.throws(()=>normalizeManifest(f.manifest,f.index,{path:f.path,generation:"1"}));
 }
});
test("import is generation-pinned, idempotent and older notifications cannot overwrite",async()=>{
 const f=fixture(),bytes=Buffer.from(JSON.stringify(f.manifest));const db=new FakeFirestore({[`processingAttempts/${f.index.attemptId}`]:f.index},{now:()=>at+20000});let generation;
 const bucket={file:(path,options)=>{assert.equal(path,f.path);generation=options.generation;return {download:async()=>[bytes]};}};
 const importer=createDiagnosticPerformance({db,bucket,FieldValue,now:()=>at+20000});
 const object={name:f.path,bucket:BUCKET,generation:"100",size:bytes.length,metadata:{sha256:createHash("sha256").update(bytes).digest("hex")}};
 assert.equal((await importer.importObject(object)).status,"imported");assert.equal(generation,"100");
 assert.equal((await importer.importObject(object)).status,"unchanged");assert.equal((await importer.importObject({...object,generation:"99"})).status,"unchanged");
 assert.equal((await db.doc(`${ROOT}/${f.index.attemptId}`).get()).data().source.generation,"100");
 assert.equal((await db.collection(INVENTORY).get()).docs.length,1);
 assert.equal((await importer.importObject({...object,metadata:{sha256:"bad"}})).status,"rejected");
});
test("reports require a verified internal admin",async()=>{
 const reports=createDeviceProcessingReports({db:new FakeFirestore(),HttpsError,now:()=>at});
 for(const caller of [null,{...admin,emailVerified:false},{...admin,email:"admin@posetek.net.evil"},{...admin,isAnonymous:true}])await assert.rejects(reports.report({},caller),e=>e.code==="permission-denied");
});
test("complete totals are independent of 100-run pages and stale cursors are refused",async()=>{
 const seed=Object.fromEntries(Array.from({length:125},(_,i)=>{const s=summary(i+1);return [`${ROOT}/${s.attemptId}`,s];}));
 const db=new FakeFirestore(seed),reports=createDeviceProcessingReports({db,HttpsError,now:()=>at+1000000});
 const req={startDate:"2026-10-02",endDate:"2026-10-02",installId:uid(9000),algorithm:"all"};
 const first=await reports.report(req,admin);assert.equal(first.totalRows,125);assert.equal(first.rows.length,100);assert.equal(first.chart.length,125);assert.equal(first.phones[0].cohorts[0].duration.count,125);
 const second=await reports.report({...req,cursor:first.nextCursor},admin);assert.equal(second.rows.length,25);assert.equal(second.phones[0].cohorts[0].duration.count,125);
 await assert.rejects(reports.report({...req,drill:"jump",cursor:first.nextCursor},admin),e=>e.code==="failed-precondition");
});
test("current filter keeps historical phones visible without claiming current samples",async()=>{
 const s=summary();s.runs[0].sourceRevision="old";
 const db=new FakeFirestore({[`${ROOT}/${s.attemptId}`]:s,[`${INVENTORY}/${uid(9000)}`]:{installId:uid(9000),machine:"iPhone18,3",lastCapturedAt:at}});
 const report=await createDeviceProcessingReports({db,HttpsError,now:()=>at+1000000}).report({startDate:"2026-10-02",endDate:"2026-10-02"},admin);
 assert.equal(report.phones.length,1);assert.equal(report.phones[0].cohorts.length,0);assert.equal(report.phones[0].recordedRuns,1);
});

test("chart focus retrieves the page containing the requested run",async()=>{
 const seed=Object.fromEntries(Array.from({length:125},(_,i)=>{const s=summary(i+1);return [`${ROOT}/${s.attemptId}`,s];}));
 const reports=createDeviceProcessingReports({db:new FakeFirestore(seed),HttpsError,now:()=>at+1000000});
 const result=await reports.report({startDate:"2026-10-02",endDate:"2026-10-02",installId:uid(9000),algorithm:"all",focusRunId:uid(10125)},admin);
 assert.equal(result.rows.length,25);assert.equal(result.rows.at(-1).runId,uid(10125));assert.equal(result.chart.length,125);
});
test("stage averages keep nested model setup separate from enclosing extraction",()=>{
 const r=summary().runs[0], c=summarize([r])[0];
 assert.equal(c.stages.find(s=>s.id==="sprint.extract").duration.mean,9900);
 assert.equal(c.stages.find(s=>s.id==="model.firstPrediction").duration.mean,100);
 assert.equal(c.wall.mean,11000);assert.equal(c.clip.mean,6);
});
test("obsolete storage generation is acknowledged instead of retried forever",async()=>{
 const f=fixture(),db=new FakeFirestore({[`processingAttempts/${f.index.attemptId}`]:f.index});
 const bucket={file:()=>({download:async()=>{throw Object.assign(new Error("Gone"),{code:404});}})};
 assert.equal((await createDiagnosticPerformance({db,bucket,FieldValue}).importObject({bucket:BUCKET,name:f.path,generation:"100",size:100})).status,"superseded");
});

test("unknown execution identities are coverage gaps, not one combined fictional phone",async()=>{
 const a=summary(1),b=summary(2);a.runs[0].installId=b.runs[0].installId=null;
 const db=new FakeFirestore({[`${ROOT}/${a.attemptId}`]:a,[`${ROOT}/${b.attemptId}`]:b});
 const result=await createDeviceProcessingReports({db,HttpsError,now:()=>at+1000000}).report({startDate:"2026-10-02",endDate:"2026-10-02",algorithm:"all"},admin);
 assert.equal(result.phones.length,0);assert.equal(result.coverage.unknownDevice,2);
});
