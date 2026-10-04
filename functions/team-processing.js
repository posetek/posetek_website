"use strict";

const { isClubAdmin } = require("./club-access");
const { completeQuery, mapBounded } = require("./insights-v2-projection");
const { effectiveStations, STATIONS } = require("./testing-events");
const { playerSegment } = require("./athlete-storage-paths");
const ROOT = "devicePerformanceDiagnostics";
const LIMITS = { attempts: 1500, runs: 2000, bytes: 2097152, decodedBytes: 32*1024*1024 };
const ms = v => typeof v?.toMillis === "function" ? v.toMillis() : typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : 0;
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v) ? v.toLowerCase() : null;
const label = (v, fallback) => typeof v === "string" && v.length <= 200 ? v : fallback;
const max = values => values.length ? Math.max(...values) : null;
const min = values => values.length ? Math.min(...values) : null;
const validTime = (v, now) => ms(v) !== null && v <= now + 300000;
const eventRow = (id,e) => ({id,name:label(e.name,"Unnamed testing session"),status:label(e.status,"unknown"),
  participantCount:count(e.participantCount),createdAt:ms(e.createdAtMillis) ?? ms(e.createdAt),
  startedAt:ms(e.startedAtMillis) ?? ms(e.startedAt),closedAt:ms(e.closedAtMillis) ?? ms(e.closedAt)});

// Deduplicate logical reps. Protocol throughput also accepts prepared partial results;
// measurement-quality throughput remains valid-only. Never guess terminal timestamps.
function completionPoints(rows, now, {includePartial=false, accepted=null} = {}) {
  const known = new Map();
  for (const r of rows) {
    if (r.dateReliable === false || !r.logicalRepId || r.mode !== "liveCapture" || !(r.outcome === "valid" || includePartial && r.outcome === "partial") || !validTime(r.terminalAt,now) || r.startedAt === null || r.terminalAt < r.startedAt) continue;
    const key = `${r.stationId}|${r.playerDocumentID}|${r.logicalRepId}`;
    if(accepted && !accepted.has(key))continue;
    if (!known.has(key) || known.get(key).at > r.terminalAt) known.set(key, {key,stationId:r.stationId,at:r.terminalAt,runId:r.runId});
  }
  return [...known.values()].sort((a,b)=>a.at-b.at || a.key.localeCompare(b.key));
}

const completed = r => r.mode === "liveCapture" && ["valid","partial"].includes(r.outcome);
const mean = values => {const known=values.filter(v=>ms(v)!==null);return {count:known.length,mean:known.length?known.reduce((a,b)=>a+b,0)/known.length:null};};
function stationTimings(rows, progress, targets, generatedAt, captures=[]) {
  const players=targets.map(target=>{
    const p=progress.find(p=>p.playerDocId===target.playerId), accepted=new Set(p?.repIds||[]);
    const recordings=rows.filter(r=>r.playerDocumentID===target.playerId&&r.mode==="liveCapture"&&r.dateReliable&&validTime(r.capturedAt,generatedAt));
    const finished=recordings.filter(r=>accepted.has(r.logicalRepId)&&completed(r)&&validTime(r.terminalAt,generatedAt)&&validTime(r.startedAt,generatedAt)&&r.terminalAt>=r.startedAt&&r.terminalAt>=r.capturedAt);
    const expected=target.drills.reduce((n,d)=>n+count(d.repCount),0);
    const covered=new Set(finished.map(r=>r.logicalRepId));
    const complete=["completed","completedPendingSync"].includes(p?.status)&&accepted.size>=expected&&[...accepted].every(id=>covered.has(id));
    const startedAt=min([...recordings.map(r=>r.capturedAt),...captures.filter(a=>a.playerDocumentID===target.playerId&&validTime(a.at,generatedAt)).map(a=>a.at)]);
    const endedAt=complete?max([...accepted].map(id=>min(finished.filter(r=>r.logicalRepId===id).map(r=>r.terminalAt)))):null;
    return {playerId:target.playerId,startedAt,endedAt,elapsedMs:complete&&startedAt!==null&&endedAt>=startedAt?endedAt-startedAt:null,
      coverage:{acceptedReps:accepted.size,timedReps:covered.size},complete};
  });
  const drillIds=[...new Set([...targets.flatMap(t=>t.drills.map(d=>d.drillType)),...rows.map(r=>r.drill)])];
  const drills=drillIds.map(drill=>{
    const measured=rows.filter(r=>r.drill===drill),groups=new Map();
    for(const r of measured){const key=JSON.stringify([r.installId,r.algorithmId,r.sourceRevision,r.configuration,r.timingKind,r.capture?.fps,r.capture?.width,r.capture?.height]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
    return {drill,runs:measured.length,finished:measured.filter(completed).length,partial:measured.filter(r=>r.outcome==="partial").length,
      groups:[...groups].map(([key,group])=>{const r=group[0],finished=group.filter(completed);return {key,installId:r.installId,sourceRevision:r.sourceRevision,configuration:r.configuration,timingKind:r.timingKind,
        duration:mean(finished.map(r=>r.durationMs??r.processingMs??r.wallMs)),processing:mean(finished.map(r=>r.processingMs)),wall:mean(finished.map(r=>r.wallMs)),
        finished:finished.length,valid:finished.filter(r=>r.outcome==="valid").length,partial:finished.filter(r=>r.outcome==="partial").length,
        failed:group.filter(r=>r.outcome==="failed").length,failedTiming:mean(group.filter(r=>r.outcome==="failed").map(r=>r.durationMs??r.processingMs??r.wallMs))};})};
  });
  const elapsed=players.map(p=>p.elapsedMs).filter(v=>v!==null).sort((a,b)=>a-b),mid=Math.floor(elapsed.length/2);
  return {playerTime:{...mean(elapsed),median:elapsed.length?(elapsed.length%2?elapsed[mid]:(elapsed[mid-1]+elapsed[mid])/2):null,min:min(elapsed),max:max(elapsed),eligible:targets.length,basis:"firstCaptureToFinalResult",players},drillTimings:drills};
}

function createTeamProcessingReports({db,HttpsError,now=Date.now}) {
  const fail = (code,message) => {throw new HttpsError(code,message);};
  const complete = (query,limit) => completeQuery(query,limit,HttpsError,50);
  async function report(input,auth) {
    if (!isClubAdmin(auth)) fail("permission-denied","PoseTek administrator access is required.");
    const generatedAt=now();
    if (!input.eventId) {
      const recent=await db.collection("testingEvents").orderBy("createdAtMillis","desc").limit(51).get();
      return {schemaVersion:1,view:"teamSessions",generatedAt,events:recent.docs.slice(0,50).map(d=>eventRow(d.id,d.data())),hasMore:recent.docs.length>50,session:null};
    }
    if (!playerSegment(input.eventId)) fail("invalid-argument","Invalid testing session ID.");
    const ref=db.collection("testingEvents").doc(input.eventId), doc=await ref.get();
    if(!doc.exists) fail("not-found","This testing session does not exist.");
    const event=doc.data();
    const [participantDocs,stationDocs,progressDocs,attempts,commits] = await Promise.all([
      complete(ref.collection("participants"),30), complete(ref.collection("stations"),3),
      complete(ref.collection("progress"),90), complete(db.collection("processingAttempts").where("testingEventId","==",doc.id),LIMITS.attempts),
      complete(ref.collection("committedReps"),900),
    ]);
    let decoded=0;
    const summaries=await mapBounded(attempts,6,async a=>{
      const d=await db.collection(ROOT).doc(a.id).get();
      if(!d.exists)return null;
      const s=d.data();decoded+=Buffer.byteLength(JSON.stringify(s));
      if(decoded>LIMITS.decodedBytes) fail("resource-exhausted","This session exceeds the report size limit. No partial totals were returned.");
      const index=a.data();
      return s.schemaVersion===1 && s.attemptId===a.id && s.playerDocumentID===index.playerDocumentID && s.reporterUid===index.reportedByUid
        && s.source?.path===index.manifestPath && (!s.testingEventId || s.testingEventId===doc.id) ? s : null;
    });
    const participants=participantDocs.map(d=>({id:d.id,name:label(d.data().displayName,"Unnamed player"),order:count(d.data().rosterOrder)})).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
    const participantIds=new Set(participants.map(p=>p.id)), stationIds=new Set(STATIONS.map(s=>s.id));
    let missingSummaries=0,oldSummaries=0,unassigned=0,staleSummaries=0;
    const rows=[],unprocessed=[];
    for(let i=0;i<attempts.length;i++) {
      const a=attempts[i],index=a.data(),s=summaries[i];
      if(!stationIds.has(index.stationId)||!participantIds.has(index.playerDocumentID)){unassigned++;continue;}
      if(!s)missingSummaries++; else {if((s.summaryVersion||1)<2)oldSummaries++; if(count(s.source?.sequence)<count(index.sequence))staleSummaries++;}
      if(!s?.runs?.length) unprocessed.push({attemptId:a.id,stationId:index.stationId,playerDocumentID:index.playerDocumentID,
        at:validTime(ms(index.occurredAt),generatedAt)?ms(index.occurredAt):null,state:label(index.lifecycle,"unknown"),lastStage:label(index.lastStage,"unknown"),summaryMissing:!s});
      // The authoritative attempt index gives older summaries exact event membership.
      for(const run of s?.runs || []) {
        const {stages,...r}=run;
        rows.push({...r,dateReliable:r.dateReliable && (r.startedAt===null || validTime(r.startedAt,generatedAt)) && (r.terminalAt==null || validTime(r.terminalAt,generatedAt)),testingEventId:doc.id,stationId:index.stationId,playerDocumentID:index.playerDocumentID,
          logicalRepId:index.repId||null,terminalAt:ms(r.terminalAt),
          stages:(stages||[]).map(({id,ms,kind,status})=>({id,ms,kind,status}))});
        if(rows.length>LIMITS.runs)fail("resource-exhausted","This session exceeds 2,000 runs. No partial totals were returned.");
      }
    }
    rows.sort((a,b)=>a.stationId.localeCompare(b.stationId)||(a.startedAt??a.capturedAt??0)-(b.startedAt??b.capturedAt??0)||a.runId.localeCompare(b.runId));
    const live=rows.filter(r=>r.mode==="liveCapture");
    const progress=progressDocs.map(d=>d.data()).filter(p=>stationIds.has(p.stationId)&&participantIds.has(p.playerDocId));
    const saved=new Set(commits.map(d=>d.id));
    const accepted=new Set(progress.flatMap(p=>(p.repIds||[]).map(id=>`${p.stationId}|${p.playerDocId}|${id}`)));
    const completions=completionPoints(live,generatedAt,{includePartial:true,accepted});
    const validCompletions=completionPoints(live,generatedAt);
    const processedCompletions=completionPoints(live,generatedAt,{includePartial:true});
    const stations=effectiveStations(event.protocolSnapshot).map(spec=>{
      const assignment=stationDocs.find(d=>d.id===spec.id)?.data()||{};
      const stationRows=live.filter(r=>r.stationId===spec.id), points=completions.filter(p=>p.stationId===spec.id);
      const progressRows=progress.filter(p=>p.stationId===spec.id);
      const repIds=[...new Set(progressRows.flatMap(p=>Array.isArray(p.repIds)?p.repIds:[]))];
      const claimed=uuid(assignment.claimedDeviceId);
      // Station leases use recordingDeviceID; diagnostics use origin/executor install IDs.
      // Join only through the exact attempt index, never by model or nearby timestamps.
      const origins=[...new Set(attempts.flatMap((a,i)=>claimed&&uuid(a.data().recordingDeviceId)===claimed&&a.data().stationId===spec.id?[summaries[i]?.originInstallId]:[]).filter(Boolean))];
      const currentInstall=origins.length===1?origins[0]:claimed;
      const knownPhones=[...new Set([...stationRows.map(r=>r.installId),currentInstall].filter(Boolean))];
      const targets=participantDocs.map(p=>({playerId:p.id,drills:effectiveStations(event.protocolSnapshot,p.data().protocolOverrides).find(s=>s.id===spec.id)?.drills||[]}));
      return {id:spec.id,order:spec.order,label:spec.label,drills:spec.drills.map(d=>d.drillType),
        plannedReps:targets.reduce((n,p)=>n+p.drills.reduce((m,d)=>m+count(d.repCount),0),0),
        completedPlayers:progressRows.filter(p=>p.status==="completed").length,progressReps:repIds.length,
        syncedReps:repIds.filter(id=>saved.has(id)).length,pendingReps:repIds.filter(id=>!saved.has(id)).length,
        processedReps:processedCompletions.filter(p=>p.stationId===spec.id).length,protocolReps:points.length,validReps:validCompletions.filter(p=>p.stationId===spec.id).length,finishedRuns:stationRows.filter(completed).length,
        ...stationTimings(stationRows,progressRows,targets,generatedAt,unprocessed.filter(a=>a.stationId===spec.id)),runs:stationRows.length,failed:stationRows.filter(r=>r.outcome==="failed").length,
        partial:stationRows.filter(r=>r.outcome==="partial").length,interrupted:stationRows.filter(r=>r.outcome==="interruptedUnknown").length,
        cancelled:stationRows.filter(r=>r.outcome==="cancelled").length,
        peakBytes:max(stationRows.map(r=>r.sampledPeakBytes).filter(v=>ms(v)!==null)),
        phones:knownPhones.map(installId=>({installId,current:installId===currentInstall,
          machine:stationRows.filter(r=>r.installId===installId&&r.machine).at(-1)?.machine||null,
          runs:stationRows.filter(r=>r.installId===installId).length})),
        players:participants.map(p=>{const row=progressRows.find(r=>r.playerDocId===p.id);const ids=Array.isArray(row?.repIds)?row.repIds:[];
          return {playerId:p.id,state:row?.status||"notStarted",completed:ids.length,synced:ids.filter(id=>saved.has(id)).length,
            planned:targets.find(t=>t.playerId===p.id).drills.reduce((n,d)=>n+count(d.repCount),0)};}),
      };
    }).sort((a,b)=>a.order-b.order);
    const observedTimes=live.flatMap(r=>[r.startedAt,r.terminalAt]).filter(v=>validTime(v,generatedAt));
    const start=ms(event.startedAtMillis)??ms(event.startedAt)??min(observedTimes);
    const closed=ms(event.closedAtMillis)??ms(event.closedAt);
    const lastObserved=max(observedTimes);
    const session={...eventRow(doc.id,event),participants,stations,rows,completions,validCompletions,processedCompletions,unprocessed,
      window:{start,end:closed??(event.status==="live"?generatedAt:lastObserved??start),lastObserved},
      coverage:{attempts:attempts.length,missingSummaries,oldSummaries,unassigned,staleSummaries,missingRepIdentity:live.filter(r=>r.outcome==="valid"&&!r.logicalRepId).length,
        unknownPhone:live.filter(r=>!r.installId).length,missingProcessing:live.filter(r=>r.processingMs===null).length,
        missingMemory:live.filter(r=>r.sampledPeakBytes===null).length,missingThermal:live.filter(r=>!r.thermalStart&&!r.thermalEnd).length,
        missingCompletionTime:live.filter(r=>r.outcome==="valid"&&!validTime(r.terminalAt,generatedAt)).length,
        reprocessing:rows.length-live.length,lastReceivedAt:max(summaries.filter(Boolean).map(s=>s.receivedAt).filter(v=>ms(v)!==null))}};
    const result={schemaVersion:1,view:"teamSessions",generatedAt,events:[eventRow(doc.id,event)],hasMore:false,session};
    if(Buffer.byteLength(JSON.stringify(result))>LIMITS.bytes)fail("resource-exhausted","This session exceeds the report size limit. No partial totals were returned.");
    return result;
  }
  return {report};
}
module.exports={createTeamProcessingReports,completionPoints,stationTimings,LIMITS};
