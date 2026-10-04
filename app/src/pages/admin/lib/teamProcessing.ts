import type { RunMeasurement, ProcessingDrill } from "./deviceProcessing";
export interface TeamEvent { id:string; name:string; status:string; participantCount:number; createdAt:number|null; startedAt:number|null; closedAt:number|null }
export interface TeamRun extends Omit<RunMeasurement,"stages"> {
  testingEventId:string; stationId:string; playerDocumentID:string; logicalRepId:string|null; terminalAt:number|null;
  stages:{id:string;ms:number|null;kind:string;status:string}[];
}
export interface StationPlayerTime { playerId:string; startedAt:number|null; endedAt:number|null; elapsedMs:number|null; complete:boolean; coverage:{acceptedReps:number;timedReps:number} }
export interface StationDrillTiming {
  drill:ProcessingDrill; runs:number; finished:number; partial:number;
  groups:{key:string;installId:string|null;sourceRevision:string|null;configuration:string|null;timingKind:string;
    duration:{count:number;mean:number|null};processing:{count:number;mean:number|null};wall:{count:number;mean:number|null};
    finished:number;valid:number;partial:number;failed:number;failedTiming:{count:number;mean:number|null}}[];
}
export interface TeamStation {
  id:string; order:number; label:string; drills:ProcessingDrill[]; plannedReps:number; completedPlayers:number;
  progressReps:number; syncedReps:number; pendingReps:number; processedReps:number; runs:number;
  finishedRuns?:number; protocolReps?:number; validReps?:number;
  playerTime?:{count:number;mean:number|null;median:number|null;min:number|null;max:number|null;eligible:number;basis:"firstCaptureToFinalResult";players:StationPlayerTime[]};
  drillTimings?:StationDrillTiming[];
  failed:number; partial:number; interrupted:number; cancelled:number; peakBytes:number|null;
  phones:{installId:string;current:boolean;machine:string|null;runs:number}[];
  players:{playerId:string;state:string;completed:number;synced:number;planned:number}[];
}
export interface TeamSession extends TeamEvent {
  participants:{id:string;name:string;order:number}[]; stations:TeamStation[]; rows:TeamRun[];
  completions:{key:string;stationId:string;at:number;runId:string}[];
  validCompletions?:TeamSession["completions"]; processedCompletions?:TeamSession["completions"];
  unprocessed:{attemptId:string;stationId:string;playerDocumentID:string;at:number|null;state:string;lastStage:string;summaryMissing:boolean}[];
  window:{start:number|null;end:number|null;lastObserved:number|null};
  coverage:{staleSummaries:number;missingRepIdentity:number;attempts:number;missingSummaries:number;oldSummaries:number;unassigned:number;unknownPhone:number;missingProcessing:number;missingMemory:number;missingThermal:number;missingCompletionTime:number;reprocessing:number;lastReceivedAt:number|null};
}
export interface TeamReport { schemaVersion:1;view:"teamSessions";generatedAt:number;events:TeamEvent[];hasMore:boolean;session:TeamSession|null }
export const time=(ms:number|null)=>ms===null?"Not reported":new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",hour:"numeric",minute:"2-digit",second:"2-digit"}).format(ms);
export function parseTeamReport(value:unknown):TeamReport {
  const r=value as TeamReport;
  const finite=(v:unknown)=>v===null||typeof v==="number"&&Number.isFinite(v)&&v>=0;
  if(!r||r.schemaVersion!==1||r.view!=="teamSessions"||!Array.isArray(r.events)||r.events.length>50||!finite(r.generatedAt))throw Error("Unsupported team-session report.");
  for(const e of r.events)if(typeof e.id!=="string"||typeof e.name!=="string")throw Error("Invalid testing session.");
  if(r.session){const s=r.session;
    if(!Array.isArray(s.rows)||s.rows.length>2000||!Array.isArray(s.stations)||s.stations.length!==3||!Array.isArray(s.participants)||s.participants.length>30
      ||!Array.isArray(s.completions)||s.completions.length>2000||!Array.isArray(s.unprocessed)||s.unprocessed.length>1500||!s.coverage||!s.window)throw Error("Incomplete team-session report.");
    for(const row of s.rows)if(typeof row.runId!=="string"||!row.capture||!Array.isArray(row.stages)||![row.processingMs,row.wallMs,row.sampledPeakBytes,row.startedAt,row.terminalAt,row.framesDecoded,row.modelCalls].every(finite))throw Error("Invalid session measurement.");
    for(const station of s.stations)if(!Array.isArray(station.phones)||!Array.isArray(station.players)||![station.plannedReps,station.syncedReps,station.processedReps].every(finite))throw Error("Invalid station summary.");
  }
  return r;
}
export async function loadTeamReport(eventId:string|null,preview=false):Promise<TeamReport> {
  if(import.meta.env.DEV&&preview)return (await import("./teamProcessingPreview")).previewTeamReport(eventId);
  const {cloud}=await import("../../../lib/firebase");
  return parseTeamReport((await cloud.httpsCallable("getDeviceProcessingV1",{timeout:120000})({view:"teamSessions",eventId})).data);
}
export type Metric="duration"|"processing"|"wall"|"thermal"|"memory"|"frames"|"calls";
export const METRICS:Record<Metric,{label:string;unit:string}>={duration:{label:"All timing",unit:"Seconds"},processing:{label:"Processing time",unit:"Seconds"},wall:{label:"Total run time",unit:"Seconds"},thermal:{label:"Heat",unit:"Thermal state at run end"},memory:{label:"Peak memory",unit:"MiB"},frames:{label:"Frame reads",unit:"Reads"},calls:{label:"Model calls",unit:"Calls"}};
export const THERMAL=["nominal","fair","serious","critical"];
export function metricValue(r:TeamRun,metric:Metric):number|null {
  if(metric==="thermal")return r.thermalEnd&&THERMAL.includes(r.thermalEnd)?THERMAL.indexOf(r.thermalEnd):null;
  const value=metric==="duration"?r.durationMs:metric==="processing"?r.processingMs:metric==="wall"?r.wallMs:metric==="memory"?r.sampledPeakBytes:metric==="frames"?r.framesDecoded:r.modelCalls;
  return value===null?null:value/(metric==="duration"||metric==="processing"||metric==="wall"?1000:metric==="memory"?1048576:1);
}
export function chartWindow(session:TeamSession):[number,number] {
  const times=[...session.unprocessed.map(a=>a.at),...session.rows.filter(r=>r.dateReliable).flatMap(r=>[r.startedAt,r.terminalAt])].filter((t):t is number=>t!==null);
  const start=Math.min(...[session.window.start,...times].filter((t):t is number=>t!==null));
  if(!Number.isFinite(start))return [0,60000];
  return [start,Math.max(start+60000,session.window.end??start,...times)];
}
