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

// One successful live-processing completion per logical rep; no pooling with retries,
// partial outcomes or later manual reprocessing. Missing terminal timestamps are not guessed.
function completionPoints(rows, now) {
  const known = new Map();
  for (const r of rows) {
    if (!r.logicalRepId || r.mode !== "liveCapture" || r.outcome !== "valid" || !validTime(r.terminalAt,now) || r.startedAt === null || r.terminalAt < r.startedAt) continue;
    const key = `${r.stationId}|${r.playerDocumentID}|${r.logicalRepId}`;
    if (!known.has(key) || known.get(key).at > r.terminalAt) known.set(key, {key,stationId:r.stationId,at:r.terminalAt,runId:r.runId});
  }
  return [...known.values()].sort((a,b)=>a.at-b.at || a.key.localeCompare(b.key));
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
    const live=rows.filter(r=>r.mode==="liveCapture"), completions=completionPoints(live,generatedAt);
    const progress=progressDocs.map(d=>d.data()).filter(p=>stationIds.has(p.stationId)&&participantIds.has(p.playerDocId));
    const saved=new Set(commits.map(d=>d.id));
    const stations=effectiveStations(event.protocolSnapshot).map(spec=>{
      const assignment=stationDocs.find(d=>d.id===spec.id)?.data()||{};
      const stationRows=live.filter(r=>r.stationId===spec.id), points=completions.filter(p=>p.stationId===spec.id);
      const progressRows=progress.filter(p=>p.stationId===spec.id);
      const repIds=[...new Set(progressRows.flatMap(p=>Array.isArray(p.repIds)?p.repIds:[]))];
      const knownPhones=[...new Set([...stationRows.map(r=>r.installId),uuid(assignment.claimedDeviceId)].filter(Boolean))];
      const targets=participantDocs.map(p=>({playerId:p.id,drills:effectiveStations(event.protocolSnapshot,p.data().protocolOverrides).find(s=>s.id===spec.id)?.drills||[]}));
      return {id:spec.id,order:spec.order,label:spec.label,drills:spec.drills.map(d=>d.drillType),
        plannedReps:targets.reduce((n,p)=>n+p.drills.reduce((m,d)=>m+count(d.repCount),0),0),
        completedPlayers:progressRows.filter(p=>p.status==="completed").length,progressReps:repIds.length,
        syncedReps:repIds.filter(id=>saved.has(id)).length,pendingReps:repIds.filter(id=>!saved.has(id)).length,
        processedReps:points.length,runs:stationRows.length,failed:stationRows.filter(r=>r.outcome==="failed").length,
        partial:stationRows.filter(r=>r.outcome==="partial").length,interrupted:stationRows.filter(r=>r.outcome==="interruptedUnknown").length,
        cancelled:stationRows.filter(r=>r.outcome==="cancelled").length,
        peakBytes:max(stationRows.map(r=>r.sampledPeakBytes).filter(v=>ms(v)!==null)),
        phones:knownPhones.map(installId=>({installId,current:installId===uuid(assignment.claimedDeviceId),
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
    const session={...eventRow(doc.id,event),participants,stations,rows,completions,unprocessed,
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
module.exports={createTeamProcessingReports,completionPoints,LIMITS};
