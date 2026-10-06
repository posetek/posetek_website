"use strict";

// Server-owned summaries of the diagnostics already uploaded by released phones.
// No native reporting flag, client write permission, or athlete-record mutation.
const { createHash } = require("node:crypto");
const { isClubAdmin } = require("./club-access");
const { midnight, localDate, shiftDate } = require("./insights-v2");
const { completeQuery, mapBounded } = require("./insights-v2-projection");
const { createTeamProcessingReports } = require("./team-processing");

const ROOT = "devicePerformanceDiagnostics";
const INVENTORY = "devicePerformanceInventory";
const BUCKET = "kickai-69dd0.firebasestorage.app";
const DRILLS = ["jump", "broadJump", "deadballShot", "sprint", "changeOfDirection", "dribbling", "freeRecord"];
const LIMITS = { manifestBytes: 1048576, runsPerAttempt: 64, stagesPerRun: 48, attempts: 5000, runs: 50000, devices: 5000, chart: 2000, responseBytes: 2097152 };
// Explicit released-source baseline, never guessed from a numerical build or
// the last phone to upload. Update alongside a reviewed app release.
const CURRENT = { label: "1.1 (31)", sourceRevisions: ["e279f408f3d0b012a5aab25d66dc373269b85de2"],
  sampling: { sprint: "scoutThenDense(scout=10,window=0.40s,stride=4,margin=1.00s,ball=all)",
    changeOfDirection: "scoutThenDense(scout=10,window=0.40s,stride=4,margin=1.00s,ball=all)",
    dribbling: "scoutThenDense(scout=10,window=0.40s,stride=4,margin=1.00s,ball=startToEnd)" } };
const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const text = (value, max = 128) => typeof value === "string" && value.length <= max ? value : null;
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value) ? value.toLowerCase() : null;
const date = value => number(value) !== null && value < 8640000000000000 ? value : null;
const thermal = value => typeof value === "number" ? ["nominal", "fair", "serious", "critical"][value] ?? null
  : ["nominal", "fair", "serious", "critical"].includes(value) ? value : null;
const sumMeasured = values => { const known = values.filter(v => v !== null); return known.length ? known.reduce((a, b) => a + b, 0) : null; };
const maxMeasured = values => { const known = values.filter(v => v !== null); return known.length ? Math.max(...known) : null; };

function normalizeManifest(manifest, index, { path, generation, receivedAt = Date.now() }) {
  const id = manifest?.identity;
  const match = /^processing_attempts\/([^/]+)\/([a-f0-9-]{36})\/manifest\.json$/.exec(path || "");
  if (!match || manifest.schemaVersion !== 1 || id?.schemaVersion !== 1 || uuid(id.attemptId) !== match[2]
      || index?.schemaVersion !== 2 || index.attemptId !== match[2] || index.manifestPath !== path
      || id.reporterUID !== match[1] || index.reportedByUid !== match[1]
      || index.playerDocumentID !== id.athleteDocumentID || index.drillType !== manifest.drill
      || !DRILLS.includes(manifest.drill) || (index.scope && index.scope !== "attempt")) throw new Error("Diagnostic identity mismatch");
  if (manifest.origin === "evaluation" || manifest.evaluationRunId) throw new Error("Evaluation diagnostics excluded");
  for (const [field, indexField] of [["testingEventID","testingEventId"],["stationID","stationId"],["logicalRepId","repId"]]) {
    if ((id[field] || null) !== (index[indexField] || null)) throw new Error("Testing event identity mismatch");
  }
  const team = { testingEventId: text(id.testingEventID), stationId: text(id.stationID, 32),
    logicalRepId: text(id.logicalRepId), playerDocumentID: text(id.athleteDocumentID), stationRunId: text(id.stationRunID) };
  const capture = manifest.capture || {}, platform = capture.platform || {}, media = capture.measuredMedia || {};
  const installId = uuid(id.originInstallId) || uuid(id.recordingDeviceID);
  const capturedAt = date(id.createdAt);
  const dateReliable = capturedAt !== null && capturedAt <= receivedAt + 300000;
  const sessionDocId = text(capture.sessionDocId);
  // Session numbers alone collide across athletes/drills. No heuristic grouping.
  const sessionId = sessionDocId ? hash([id.athleteDocumentID, sessionDocId]).slice(0, 32)
    : number(capture.sessionNumber) !== null ? hash([id.athleteDocumentID, manifest.drill, capture.sessionNumber]).slice(0, 32) : null;
  const entries = Object.entries(manifest.runs || {});
  if (entries.length > LIMITS.runsPerAttempt) throw new Error("Diagnostic run limit exceeded");
  const runs = entries.map(([runId, run]) => {
    if (uuid(runId) !== runId || run.identity?.processingRunId !== runId || run.identity?.attemptId !== id.attemptId) throw new Error("Diagnostic run identity mismatch");
    const p = run.performance || {}, execution = run.execution || {};
    if ((p.runId && p.runId !== runId) || (p.attemptId && p.attemptId !== id.attemptId)) throw new Error("Performance block identity mismatch");
    if (!Array.isArray(run.stageSummaries || []) || (run.stageSummaries || []).length > LIMITS.stagesPerRun) throw new Error("Diagnostic stage limit exceeded");
    const stages = (run.stageSummaries || []).map(s => ({
      id: text(s.stageId, 96), parent: text(s.parentStageId, 96), pass: text(s.passId, 96),
      kind: s.timingKind === "nestedOperation" ? "nestedOperation" : "mainPhase", status: text(s.status, 32),
      ms: number(s.elapsedMs), frames: number(s.framesDecoded), calls: number(s.modelCalls),
    })).filter(s => s.id);
    const outcome = run.outcome?.prepared?.status === "valid" ? "valid" : run.outcome?.prepared ? "partial"
      : run.outcome?.failed ? "failed" : run.outcome?.cancelled ? "cancelled" : run.interruptedAt != null ? "interruptedUnknown" : "running";
    const startedAt = date(run.startedAt), terminalAt = date(run.terminalAt);
    const processingMs = number(p.processingMs);
    const wallMs = number(p.wallMs) ?? (startedAt !== null && terminalAt !== null && terminalAt >= startedAt ? terminalAt - startedAt : null);
    const sameLaunch = run.identity.launchId && run.identity.launchId === id.originLaunchId;
    const sourceRevision = text(p.sourceRevision) || (sameLaunch ? text(platform.sourceRevision) : null);
    const configuration = text(p.configuration, 32) || (sameLaunch ? text(platform.configuration, 32) : null);
    const sampling = text(execution.samplingSchedule, 256);
    const policyHash = text(p.policyHash) || text(execution.policyHash);
    const algorithmId = hash([manifest.drill, sourceRevision, policyHash, sampling, text(execution.poseDelegateRequested, 16)]).slice(0, 24);
    const executor = uuid(run.identity.executorInstallId) || (sameLaunch ? installId : null);
    const appliedFPS = number(capture.captureProfile?.appliedFPS) ?? number(capture.requestedFPS);
    const width = number(media.uprightDimensions?.[0]), height = number(media.uprightDimensions?.[1]);
    return {
      ...team, terminalAt, runId, attemptId: id.attemptId, retryOf: uuid(run.identity.retryOfRunId), installId: executor,
      originInstallId: installId, drill: manifest.drill, sessionId, sessionNumber: number(capture.sessionNumber),
      repNumber: number(capture.repNumber) ?? number(p.repIndex), capturedAt, startedAt, dateReliable,
      outcome, mode: text(run.identity.mode, 32), algorithmId, sourceRevision, policyHash, sampling, configuration,
      build: text(p.appBuild, 32) || text(capture.build, 32), appVersion: text(capture.appVersion, 32),
      machine: text(p.machine, 64) || (sameLaunch ? text(platform.machine, 64) : null),
      osVersion: text(p.osVersion, 64) || (sameLaunch ? text(platform.operatingSystem, 64) : null),
      processingMs, wallMs, durationMs: processingMs ?? wallMs,
      timingKind: processingMs !== null ? "processing" : wallMs !== null ? "runWall" : "unavailable",
      framesDecoded: number(p.framesDecoded) ?? sumMeasured(stages.filter(s => s.kind === "mainPhase").map(s => s.frames)),
      modelCalls: number(p.modelCalls) ?? sumMeasured(stages.filter(s => s.kind === "mainPhase").map(s => s.calls)),
      sampledPeakBytes: number(p.sampledPeakBytes), minAvailableBytes: number(p.minAvailableBytes),
      thermalStart: thermal(p.thermalStateStart), thermalEnd: thermal(p.thermalStateEnd),
      lowPower: typeof p.lowPowerModeEnabled === "boolean" ? p.lowPowerModeEnabled : null,
      capture: { fps: appliedFPS, width, height, durationSeconds: number(media.durationSeconds) },
      failureStage: text(run.outcome?.failed?._0?.stage, 96) || (outcome === "failed" ? text(run.lastStage, 96) : null),
      stages, provenance: "diagnosticManifest",
    };
  });
  return { ...team, schemaVersion: 1, attemptId: id.attemptId, originInstallId: installId,
    reporterUid: index.reportedByUid, playerDocumentID: index.playerDocumentID,
    capturedAt, dateReliable, sessionId, drill: manifest.drill, runs,
    source: { path, generation: String(generation), sequence: number(manifest.sequence), manifestUpdatedAt: date(manifest.updatedAt) },
    receivedAt, summaryVersion: 2 };
}

function createDiagnosticPerformance({ db, bucket, FieldValue, now = Date.now }) {
  async function importObject(object) {
    if (object.bucket !== BUCKET || !/^processing_attempts\/[^/]+\/[a-f0-9-]{36}\/manifest\.json$/.test(object.name || "")) return { status: "ignored" };
    if (!/^\d+$/.test(String(object.generation)) || !Number.isFinite(Number(object.size)) || Number(object.size) < 1 || Number(object.size) > LIMITS.manifestBytes) return { status: "rejected", reason: "objectBounds" };
    const attemptId = object.name.split("/")[2];
    const index = await db.doc(`processingAttempts/${attemptId}`).get();
    if (!index.exists) throw new Error("Diagnostic index not yet available");
    // Pin the object generation, so an older event never reads newer bytes.
    const file = bucket.file(object.name, { generation: object.generation });
    let bytes;
    try { [bytes] = await file.download({ validation: "crc32c" }); }
    catch (error) { if (Number(error.code) === 404) return { status: "superseded", attemptId }; throw error; }
    if (bytes.length > LIMITS.manifestBytes) return { status: "rejected", reason: "objectBounds" };
    if (object.metadata?.sha256 && object.metadata.sha256 !== hash(bytes)) return { status: "rejected", reason: "digestMismatch" };
    let summary;
    try { summary = normalizeManifest(JSON.parse(bytes.toString("utf8")), index.data(), { path: object.name, generation: object.generation, receivedAt: now() }); }
    catch { return { status: "rejected", reason: "invalidManifest", attemptId }; }
    if (Buffer.byteLength(JSON.stringify(summary)) > 800000) return { status: "rejected", reason: "summaryBounds", attemptId };
    const ref = db.collection(ROOT).doc(attemptId);
    return db.runTransaction(async tx => {
      const previous = await tx.get(ref);
      if (previous.exists) {
        const prior = previous.data(), difference = BigInt(prior.source.generation) - BigInt(object.generation);
        if (difference > 0n || (difference === 0n && (prior.summaryVersion || 1) >= summary.summaryVersion)) return { status: "unchanged", attemptId };
      }
      const installs = [...new Set([summary.originInstallId, ...summary.runs.map(r => r.installId)].filter(Boolean))];
      const inventory = await Promise.all(installs.map(id => tx.get(db.collection(INVENTORY).doc(id))));
      tx.set(ref, { ...summary, firstReceivedAt: previous.exists ? previous.data().firstReceivedAt : now(), updatedAtServer: FieldValue.serverTimestamp() });
      for (let i = 0; i < installs.length; i++) {
        const id = installs[i], old = inventory[i].exists ? inventory[i].data() : {};
        const latest = summary.runs.filter(r => r.installId === id).sort((a,b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
        const eventAt = summary.dateReliable ? summary.capturedAt : null;
        tx.set(db.collection(INVENTORY).doc(id), {
          installId: id, firstCapturedAt: old.firstCapturedAt == null ? eventAt : eventAt == null ? old.firstCapturedAt : Math.min(old.firstCapturedAt, eventAt),
          lastCapturedAt: Math.max(old.lastCapturedAt || 0, eventAt || 0) || null,
          lastReceivedAt: now(), machine: eventAt >= (old.lastCapturedAt || 0) ? latest?.machine || old.machine || null : old.machine || null, osVersion: eventAt >= (old.lastCapturedAt || 0) ? latest?.osVersion || old.osVersion || null : old.osVersion || null,
          label: old.label || null, updatedAtServer: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return { status: "imported", attemptId, runs: summary.runs.length };
    });
  }
  return { importObject };
}

function currentRun(run) {
  return CURRENT.sourceRevisions.includes(run.sourceRevision)
    && (!CURRENT.sampling[run.drill] || run.sampling === CURRENT.sampling[run.drill]);
}
function distribution(values) {
  const sorted = values.filter(v => number(v) !== null).sort((a,b) => a-b), n = sorted.length;
  const quantile = p => { if (!n) return null; const h=(n-1)*p, lo=Math.floor(h), hi=Math.ceil(h); return sorted[lo]+(sorted[hi]-sorted[lo])*(h-lo); };
  return { count: n, mean: n ? sorted.reduce((a,b) => a+b,0)/n : null, median: quantile(.5), p90: quantile(.9), max: n ? sorted[n-1] : null };
}
function cohortKey(r) { return hash([r.drill, r.algorithmId, r.configuration, r.timingKind, r.capture.fps, r.capture.width, r.capture.height]).slice(0,24); }
function summarize(runs) {
  const groups = new Map();
  for (const run of runs) { const key=cohortKey(run); if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(run); }
  return [...groups].map(([key, rows]) => {
    const r=rows[0], finished=rows.filter(x=>["valid","partial"].includes(x.outcome) && x.mode === "liveCapture");
    return { key, drill:r.drill, algorithmId:r.algorithmId, sourceRevision:r.sourceRevision, sampling:r.sampling,
      configuration:r.configuration, timingKind:r.timingKind, capture:r.capture, current:currentRun(r),
      builds:[...new Set(rows.map(x=>x.build).filter(Boolean))], count:rows.length,
      successful:rows.filter(x=>x.outcome === "valid").length, failed:rows.filter(x=>x.outcome === "failed").length,
      partial:rows.filter(x=>x.outcome === "partial").length, other:rows.filter(x=>!["valid","failed","partial"].includes(x.outcome)).length,
      successfulDuration:distribution(rows.filter(x=>x.outcome==="valid"&&x.mode==="liveCapture").map(x=>x.durationMs)),
      partialDuration:distribution(rows.filter(x=>x.outcome==="partial"&&x.mode==="liveCapture").map(x=>x.durationMs)),
      failedDuration:distribution(rows.filter(x=>x.outcome==="failed"&&x.mode==="liveCapture").map(x=>x.durationMs)),
      duration:distribution(finished.map(x=>x.durationMs)), wall:distribution(finished.map(x=>x.wallMs)), clip:distribution(finished.map(x=>x.capture.durationSeconds)),
      stages:[...new Set(finished.flatMap(x=>x.stages.map(s=>s.id)))].map(id=>({id,kind:finished.flatMap(x=>x.stages).find(s=>s.id===id).kind,
        duration:distribution(finished.map(x=>sumMeasured(x.stages.filter(s=>s.id===id).map(s=>s.ms))))})),
      frames:distribution(finished.map(x=>x.framesDecoded)), calls:distribution(finished.map(x=>x.modelCalls)),
      sampledPeakBytes:maxMeasured(rows.map(x=>x.sampledPeakBytes)), memorySamples:rows.filter(x=>x.sampledPeakBytes!==null).length,
      thermalStates:[...new Set(rows.flatMap(x=>[x.thermalStart,x.thermalEnd]).filter(Boolean))], lowPowerRuns:rows.filter(x=>x.lowPower === true).length,
    };
  }).sort((a,b)=>a.drill.localeCompare(b.drill)||Number(b.current)-Number(a.current)||a.key.localeCompare(b.key));
}

function createDeviceProcessingReports({ db, HttpsError, now = Date.now }) {
  const invalid = message => { throw new HttpsError("invalid-argument",message); };
  async function readPeriod(start,end) {
    const result=[]; let cursor=null, bytes=0;
    while(true) {
      let q=db.collection(ROOT).where("capturedAt",">=",start).where("capturedAt","<",end).orderBy("capturedAt").orderBy("__name__").limit(20);
      if(cursor) q=q.startAfter(cursor.data().capturedAt,cursor.id);
      const page=await q.get();
      for(const doc of page.docs) {
        bytes+=Buffer.byteLength(JSON.stringify(doc.data()));
        if(result.length>=LIMITS.attempts || bytes>64*1024*1024) throw new HttpsError("resource-exhausted","Shorten the date range. No partial statistics were returned.");
        result.push(doc);
      }
      if(page.docs.length<20)return result;
      cursor=page.docs.at(-1);
    }
  }
  async function readIndexes(start,end) {
    const out=[];let cursor=null;
    while(true){
      let q=db.collection("processingAttempts").where("occurredAt",">=",new Date(start)).where("occurredAt","<",new Date(end)).orderBy("occurredAt").orderBy("__name__").limit(250);
      if(cursor)q=q.startAfter(cursor.data().occurredAt,cursor.id);
      const page=await q.get();out.push(...page.docs);
      if(out.length>LIMITS.attempts)throw new HttpsError("resource-exhausted","Shorten the date range. No partial diagnostic coverage was returned.");
      if(page.docs.length<250)return out;
      cursor=page.docs.at(-1);
    }
  }
  async function report(input, auth) {
    if (!isClubAdmin(auth)) throw new HttpsError("permission-denied","PoseTek administrator access is required.");
    const zone = input.timeZone || "America/Los_Angeles";
    try { new Intl.DateTimeFormat("en",{timeZone:zone}); } catch { invalid("Unknown time zone."); }
    const endDate = input.endDate || localDate(now(),zone), startDate = input.startDate || shiftDate(endDate,-89);
    if (![startDate,endDate].every(x=>typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString().slice(0,10)===x)) invalid("Use YYYY-MM-DD dates.");
    let start,end;
    try { start=midnight(startDate,zone); end=midnight(shiftDate(endDate,1),zone); } catch { invalid("Invalid calendar date."); }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start || end-start>91*86400000) invalid("Choose up to 90 days.");
    const unknownOnly=input.unattributed===true;
    if(input.unattributed!=null&&typeof input.unattributed!=="boolean")invalid("Invalid unattributed selection.");
    const install=input.installId == null ? null : uuid(input.installId);
    if(unknownOnly&&input.installId!=null)invalid("Choose a phone or unattributed runs.");
    if (input.installId != null && !install) invalid("Invalid phone identity.");
    const drill=input.drill || "all", algorithm=input.algorithm || "all", configuration=input.configuration || "all";
    if (drill!=="all" && !DRILLS.includes(drill)) invalid("Unknown drill.");
    if (!["current","all"].includes(algorithm) && !/^[a-f0-9]{24}$/.test(algorithm)) invalid("Unknown algorithm.");
    if (!["all","Release","Debug"].includes(configuration)) invalid("Unknown build configuration.");
    const sessionId=input.sessionId || null;
    if (sessionId && !/^[a-f0-9]{32}$/.test(sessionId)) invalid("Invalid session.");
    const [docs, inventory, indexes] = await Promise.all([
      readPeriod(start,end),
      completeQuery(db.collection(INVENTORY),LIMITS.devices,HttpsError),
      readIndexes(start,end),
    ]);
    const summaries=docs.map(d=>d.data()).filter(d=>d.schemaVersion === 1);
    const allRuns=summaries.flatMap(d=>d.runs);
    const summaryIds=new Set(docs.map(d=>d.id));
    // Check absent IDs directly: capture timestamps can differ from index timestamps.
    const absent=await mapBounded(indexes.filter(d=>!summaryIds.has(d.id)),6,async d=>(await db.collection(ROOT).doc(d.id).get()).exists?null:d);
    const unavailableAttempts=absent.filter(Boolean).map(d=>{const a=d.data();return {attemptId:d.id,at:typeof a.occurredAt?.toMillis==="function"?a.occurredAt.toMillis():null,
      drill:text(a.drillType),recordingDeviceId:uuid(a.recordingDeviceId),testingEventId:text(a.testingEventId),stationId:text(a.stationId),state:text(a.lifecycle)};}).sort((a,b)=>(b.at||0)-(a.at||0));
    if (allRuns.length>LIMITS.runs) throw new HttpsError("resource-exhausted","Narrow the date range. No partial statistics were returned.");
    const base=allRuns.filter(r=>(unknownOnly ? !r.installId : !install || r.installId === install) && (drill === "all" || r.drill === drill)
      && (configuration === "all" || r.configuration === configuration));
    const filtered=base.filter(r=>algorithm === "all" || (algorithm === "current" ? currentRun(r) : r.algorithmId === algorithm));
    const sessions=[...new Set(base.map(r=>r.sessionId).filter(Boolean))].map(id=>{
      const rows=base.filter(r=>r.sessionId===id);return {id,number:rows[0].sessionNumber,startedAt:Math.min(...rows.map(r=>r.capturedAt)),runs:rows.length,drills:[...new Set(rows.map(r=>r.drill))]};
    }).sort((a,b)=>b.startedAt-a.startedAt);
    const chosen=filtered.filter(r=>!sessionId||r.sessionId===sessionId).sort((a,b)=>(a.startedAt||a.capturedAt)-(b.startedAt||b.capturedAt)||a.runId.localeCompare(b.runId));
    const inventoryRows=inventory.map(d=>d.data());
    const known=new Map(inventoryRows.map(d=>[d.installId,d]));
    for(const r of allRuns) if(r.installId && !known.has(r.installId)) known.set(r.installId,{installId:r.installId,machine:r.machine,label:null,lastCapturedAt:r.capturedAt,lastReceivedAt:null});
    const phones=[...known.values()].filter(p=>!unknownOnly&&(!install||p.installId===install)).map(p=>({
      installId:p.installId,label:p.label||null,machine:p.machine||null,osVersion:p.osVersion||null,
      lastCapturedAt:p.lastCapturedAt||null,lastReceivedAt:p.lastReceivedAt||null,
      recordedRuns:base.filter(r=>r.installId===p.installId).length,
      cohorts:summarize(chosen.filter(r=>r.installId===p.installId)),
      totals:{framesDecoded:sumMeasured(chosen.filter(r=>r.installId===p.installId).map(r=>r.framesDecoded)),modelCalls:sumMeasured(chosen.filter(r=>r.installId===p.installId).map(r=>r.modelCalls))},
    })).sort((a,b)=>(b.lastCapturedAt||0)-(a.lastCapturedAt||0));
    const revision=hash(summaries.map(d=>[d.attemptId,d.source.generation]).sort());
    const queryHash=hash([startDate,endDate,zone,install,unknownOnly,drill,algorithm,configuration,sessionId,revision]);
    let offset=0;
    if(input.cursor) { if(typeof input.cursor!=="string" || input.cursor.length>2048) invalid("Invalid cursor."); try { const c=JSON.parse(Buffer.from(input.cursor,"base64url").toString());if(c.key!==queryHash||!Number.isSafeInteger(c.offset)||c.offset<0)throw Error();offset=c.offset; }catch{throw new HttpsError("failed-precondition","The report changed. Refresh to start again.");} }
    const pageSize=100;
    if(input.focusRunId) {
      if(!uuid(input.focusRunId))invalid("Invalid run identity.");
      const index=chosen.findIndex(r=>r.runId===input.focusRunId);
      if(index>=0)offset=Math.floor(index/pageSize)*pageSize;
    }
    const rows=install || unknownOnly ? chosen.slice(offset,offset+pageSize) : [];
    const chartRows=install || unknownOnly ? chosen.filter(r=>r.dateReliable) : [];
    if(chartRows.length>LIMITS.chart) throw new HttpsError("resource-exhausted","Choose a single session or a shorter range to show every run in the chart.");
    const response={schemaVersion:1,generatedAt:now(),period:{startDate,endDate,timeZone:zone},current:CURRENT,
      filters:{installId:install,drill,algorithm,configuration,sessionId,unattributed:unknownOnly?"true":null},revision,
      unavailableAttempts,
      coverage:{attempts:summaries.length,indexedAttempts:indexes.length,missingSummaries:unavailableAttempts.length,runs:allRuns.length,unknownDevice:allRuns.filter(r=>!r.installId).length,
        filteredOut:base.length-chosen.length,timingMissing:chosen.filter(r=>r.durationMs===null).length,memoryMissing:chosen.filter(r=>r.sampledPeakBytes===null).length},
      algorithms:[...new Map(base.map(r=>[r.algorithmId,{id:r.algorithmId,sourceRevision:r.sourceRevision,sampling:r.sampling,drill:r.drill,current:currentRun(r)}])).values()],
      phones,sessions,rows,totalRows:chosen.length,
      chart:chartRows.map(({stages,...r})=>r),
      nextCursor:(install || unknownOnly) && offset+pageSize<chosen.length ? Buffer.from(JSON.stringify({key:queryHash,offset:offset+pageSize})).toString("base64url"):null,
    };
    if(Buffer.byteLength(JSON.stringify(response))>LIMITS.responseBytes)throw new HttpsError("resource-exhausted","Choose a drill, phone or shorter range. No partial statistics were returned.");
    return response;
  }
  return {report};
}

function createDeviceProcessingEntrypoints(functions,admin,requireCaller) {
  const db=admin.firestore(), bucket=admin.storage().bucket(BUCKET);
  const importer=createDiagnosticPerformance({db,bucket,FieldValue:admin.firestore.FieldValue});
  const reports=createDeviceProcessingReports({db,HttpsError:functions.https.HttpsError});
  const teams=createTeamProcessingReports({db,HttpsError:functions.https.HttpsError});
  return {
    observeDeviceProcessingManifest: functions.runWith({memory:"512MB",timeoutSeconds:120,maxInstances:5,failurePolicy:true}).storage.bucket(BUCKET).object().onFinalize(object=>importer.importObject(object)),
    getDeviceProcessingV1: functions.runWith({memory:"512MB",timeoutSeconds:120,maxInstances:10}).https.onCall((data,context)=>(data?.view === "teamSessions" ? teams : reports).report(data||{},requireCaller(context))),
  };
}
module.exports={ROOT,INVENTORY,BUCKET,DRILLS,LIMITS,CURRENT,normalizeManifest,createDiagnosticPerformance,createDeviceProcessingReports,createDeviceProcessingEntrypoints,distribution,summarize,currentRun};
