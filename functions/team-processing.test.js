"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {createTeamProcessingReports,completionPoints}=require("./team-processing");
const {FakeFirestore,HttpsError,Timestamp}=require("./test-support/device-performance/fake-firestore");
const {effectiveStations}=require("./testing-events");
const at=Date.parse("2026-10-03T18:00:00Z"),admin={uid:"admin",email:"admin@posetek.net",emailVerified:true,isAnonymous:false};
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function run(n=1,extra={}){return {runId:uid(n),attemptId:uid(n+100),stationId:"station-1",playerDocumentID:"p1",logicalRepId:`rep-${n}`,installId:uid(9000),mode:"liveCapture",outcome:"valid",startedAt:at+n*1000,terminalAt:at+n*1000+500,dateReliable:true,capturedAt:at+n*1000,
  processingMs:450,wallMs:500,sampledPeakBytes:1000000,thermalStart:"nominal",thermalEnd:"fair",machine:"iPhone18,3",drill:"jump",stages:[],...extra};}
function seed(){return {"testingEvents/event":{name:"Four players",createdAtMillis:at-1000,startedAtMillis:at,status:"live",participantCount:4,protocolSnapshot:effectiveStations()},
  ...Object.fromEntries([1,2,3,4].map(n=>[`testingEvents/event/participants/p${n}`,{displayName:`Player ${n}`,rosterOrder:n}])),
  ...Object.fromEntries([1,2,3].map(n=>[`testingEvents/event/stations/station-${n}`,{claimedDeviceId:uid(8999+n).toUpperCase()}]))};}
function add(s,r,indexExtra={},summaryExtra={}){const index={attemptId:r.attemptId,testingEventId:"event",stationId:r.stationId,repId:r.logicalRepId,playerDocumentID:r.playerDocumentID,reportedByUid:"admin",manifestPath:`processing_attempts/admin/${r.attemptId}/manifest.json`,occurredAt:Timestamp.fromMillis(r.capturedAt),...indexExtra};
 s[`processingAttempts/${r.attemptId}`]=index;s[`devicePerformanceDiagnostics/${r.attemptId}`]={schemaVersion:1,summaryVersion:2,attemptId:r.attemptId,playerDocumentID:r.playerDocumentID,reporterUid:"admin",source:{path:index.manifestPath,sequence:1},receivedAt:at+10000,runs:[r],...summaryExtra};}
async function report(s,input={eventId:"event"}){return createTeamProcessingReports({db:new FakeFirestore(s),HttpsError,now:()=>at+60000}).report(input,admin);}
test("one event joins four players and keeps all three assigned phones visible",async()=>{
 const s=seed();for(let p=1;p<=4;p++)add(s,run(p,{playerDocumentID:`p${p}`}));
 const r=(await report(s)).session;assert.equal(r.participants.length,4);assert.equal(r.rows.length,4);assert.equal(r.stations.length,3);assert.equal(r.stations[2].phones[0].runs,0);assert.equal(r.stations[0].plannedReps,12);assert.equal(r.stations[1].plannedReps,28);assert.equal(r.stations[2].plannedReps,40);assert.equal(r.stations[0].phones[0].installId,uid(9000));
});
test("unique throughput excludes partial, failed, undated, unidentified, and reprocessed runs",()=>{
 const base=run();const rows=[base,run(2,{logicalRepId:base.logicalRepId}),run(3,{outcome:"partial"}),run(4,{outcome:"failed"}),run(5,{terminalAt:null}),run(6,{mode:"reprocess"}),run(7,{logicalRepId:null}),run(8,{terminalAt:at+1}),run(9,{terminalAt:at+400000}),run(10,{dateReliable:false})];
 assert.equal(completionPoints(rows,at+10000).length,1);assert.equal(completionPoints(rows,at+10000)[0].runId,base.runId);
});
test("station attribution follows each attempt even when the assigned phone changes",async()=>{
 const s=seed();add(s,run());s["testingEvents/event/stations/station-1"].claimedDeviceId=uid(9999);const r=(await report(s)).session;
 assert.equal(r.rows[0].installId,uid(9000));assert.equal(r.stations[0].phones.length,2);assert.equal(r.stations[0].phones.find(p=>p.installId===uid(9999)).runs,0);
});
test("progress, acknowledged uploads and diagnostic throughput are separate counts",async()=>{
 const s=seed();add(s,run());s["testingEvents/event/progress/station-1_p1"]={stationId:"station-1",playerDocId:"p1",repIds:["rep-1","rep-2"],status:"completedPendingSync"};s["testingEvents/event/committedReps/rep-1"]={};
 const st=(await report(s)).session.stations[0];assert.equal(st.progressReps,2);assert.equal(st.syncedReps,1);assert.equal(st.pendingReps,1);assert.equal(st.processedReps,1);assert.equal(st.completedPlayers,0);
});
test("participant overrides change planned work without assuming four identical workloads",async()=>{
 const s=seed();s["testingEvents/event/participants/p1"].protocolOverrides={jump:{repCount:1,sides:[]}};assert.equal((await report(s)).session.stations[0].plannedReps,10);
});
test("legacy summary membership uses exact index identity, never date proximity",async()=>{
 const s=seed();add(s,run(),{}, {summaryVersion:1});add(s,run(2),{testingEventId:"other"});add(s,run(3),{}, {reporterUid:"forged"});
 const r=(await report(s)).session;assert.equal(r.rows.length,1);assert.equal(r.coverage.oldSummaries,1);assert.equal(r.coverage.missingSummaries,1);
});
test("missing manifests, capture interruptions and unmatched roster records stay explicit",async()=>{
 const s=seed();add(s,run(),{lifecycle:"interruptedUnknown"},{runs:[]});add(s,run(2));delete s[`devicePerformanceDiagnostics/${uid(102)}`];add(s,run(3,{playerDocumentID:"not-on-roster"}));
 const r=(await report(s)).session;assert.equal(r.rows.length,0);assert.equal(r.unprocessed.length,2);assert.equal(r.unprocessed[0].state,"interruptedUnknown");assert.equal(r.coverage.unassigned,1);assert.equal(r.stations[0].peakBytes,null);
});
test("stale summaries and missing values remain measurable coverage gaps",async()=>{
 const s=seed();add(s,run(1,{processingMs:null,sampledPeakBytes:null,thermalStart:null,thermalEnd:null,terminalAt:null}),{sequence:5});
 const r=(await report(s)).session;assert.equal(r.coverage.staleSummaries,1);assert.equal(r.coverage.missingMemory,1);assert.equal(r.coverage.missingCompletionTime,1);assert.equal(r.completions.length,0);
});
test("cross-event or malformed event access is rejected and admin is checked before any read",async()=>{
 const db=new FakeFirestore(seed()),api=createTeamProcessingReports({db,HttpsError,now:()=>at});
 for(const a of [null,{...admin,isAnonymous:true},{...admin,emailVerified:false},{...admin,email:"admin@posetek.net.evil"}])await assert.rejects(api.report({eventId:"event"},a),e=>e.code==="permission-denied");assert.equal(db.stats.reads,0);
 await assert.rejects(api.report({eventId:"../players"},admin),e=>e.code==="invalid-argument");await assert.rejects(api.report({eventId:"missing"},admin),e=>e.code==="not-found");
});
test("session list is explicitly the most recent 50, never a truncated aggregate",async()=>{
 const s=seed();for(let n=0;n<52;n++)s[`testingEvents/event-${n}`]={createdAtMillis:at+n,participantCount:4,name:`Event ${n}`};const r=await report(s,{});assert.equal(r.events.length,50);assert.equal(r.hasMore,true);assert.equal(r.events[0].name,"Event 51");assert.equal(r.session,null);
});
test("oversized event fails instead of returning incomplete chart totals",async()=>{
 const s=seed();add(s,run(),{}, {runs:Array.from({length:2001},(_,i)=>run(i+1))});await assert.rejects(report(s),e=>e.code==="resource-exhausted");
});
