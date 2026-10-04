export const PROCESSING_DRILLS = { jump: "Vertical jump", broadJump: "Broad jump", deadballShot: "Kick", sprint: "Sprint", changeOfDirection: "Change of direction", dribbling: "Dribbling", freeRecord: "Free record" };
export type ProcessingDrill = keyof typeof PROCESSING_DRILLS;
export interface RunMeasurement {
  runId: string; attemptId: string; retryOf: string | null; installId: string | null; originInstallId: string | null;
  drill: ProcessingDrill; sessionId: string | null; sessionNumber: number | null; repNumber: number | null;
  capturedAt: number; startedAt: number | null; dateReliable: boolean; outcome: string; mode: string | null;
  algorithmId: string; sourceRevision: string | null; policyHash: string | null; sampling: string | null;
  configuration: string | null; build: string | null; appVersion: string | null; machine: string | null; osVersion: string | null;
  processingMs: number | null; wallMs: number | null; durationMs: number | null; timingKind: string;
  framesDecoded: number | null; modelCalls: number | null; sampledPeakBytes: number | null; minAvailableBytes: number | null;
  thermalStart: string | null; thermalEnd: string | null; lowPower: boolean | null;
  capture: { fps: number | null; width: number | null; height: number | null; durationSeconds: number | null };
  failureStage: string | null; stages?: { id: string; parent: string | null; pass: string | null; kind: string; status: string; ms: number | null; frames: number | null; calls: number | null }[];
  provenance: string;
}
export interface Distribution { count: number; mean: number | null; median: number | null; p90: number | null; max: number | null }
export interface ProcessingCohort {
  key: string; drill: ProcessingDrill; algorithmId: string; sourceRevision: string | null; sampling: string | null;
  configuration: string | null; timingKind: string; capture: RunMeasurement["capture"]; current: boolean; builds: string[];
  count: number; successful: number; failed: number; partial: number; other: number;
  duration: Distribution; successfulDuration?: Distribution; partialDuration?: Distribution; failedDuration?: Distribution; wall?: Distribution; clip?: Distribution; stages?: { id: string; kind: string; duration: Distribution }[]; frames: Distribution; calls: Distribution;
  sampledPeakBytes: number | null; memorySamples: number; thermalStates: string[]; lowPowerRuns: number;
}
export interface ProcessingPhone {
  installId: string | null; label: string | null; machine: string | null; osVersion: string | null;
  lastCapturedAt: number | null; lastReceivedAt: number | null; recordedRuns: number; cohorts: ProcessingCohort[];
  totals?: { framesDecoded: number | null; modelCalls: number | null };
}
export interface ProcessingReport {
  schemaVersion: 1; generatedAt: number; period: { startDate: string; endDate: string; timeZone: string };
  current: { label: string; sourceRevisions: string[] }; filters: Record<string, string | null>; revision: string;
  unavailableAttempts?: {attemptId:string;at:number|null;drill:string|null;recordingDeviceId:string|null;testingEventId:string|null;stationId:string|null;state:string|null}[];
  coverage: { indexedAttempts?:number; missingSummaries?:number; filteredOut?:number; attempts: number; runs: number; unknownDevice: number; timingMissing: number; memoryMissing: number };
  algorithms: { id: string; sourceRevision: string | null; sampling: string | null; drill: ProcessingDrill; current: boolean }[];
  phones: ProcessingPhone[]; sessions: { id: string; number: number | null; startedAt: number; runs: number; drills: ProcessingDrill[] }[];
  rows: RunMeasurement[]; chart: RunMeasurement[]; totalRows: number; nextCursor: string | null;
}

// A bounded, versioned reader: no fallback from an API failure to synthetic data.
export function parseProcessingReport(value: unknown): ProcessingReport {
  if (!value || typeof value !== "object" || (value as {schemaVersion?:number}).schemaVersion !== 1) throw new Error("The phone report format is unsupported. Reload the page.");
  const r=value as ProcessingReport;
  if (!Array.isArray(r.phones) || r.phones.length>5001 || !Array.isArray(r.rows) || r.rows.length>100
    || !Array.isArray(r.chart) || r.chart.length>2000 || !Array.isArray(r.sessions) || !Array.isArray(r.algorithms)
    || !r.period || !r.current || !r.coverage || typeof r.totalRows!=="number") throw new Error("The phone report is incomplete.");
  const finite=(v:unknown)=>v===null || typeof v === "number" && Number.isFinite(v) && v>=0;
  for(const phone of r.phones) {
    if(!Array.isArray(phone.cohorts) || !finite(phone.lastCapturedAt)) throw new Error("Invalid phone summary.");
    for(const c of phone.cohorts) if(!c.duration || ![c.duration.mean,c.duration.median,c.duration.p90,c.sampledPeakBytes].every(finite)
      || !["processing","runWall","unavailable"].includes(c.timingKind)) throw new Error("Invalid phone measurement.");
  }
  for(const run of [...r.rows,...r.chart]) if(typeof run.runId!=="string" || typeof run.attemptId!=="string"
    || ![run.durationMs,run.processingMs,run.wallMs,run.sampledPeakBytes,run.framesDecoded,run.modelCalls].every(finite)
    || !run.capture || !["processing","runWall","unavailable"].includes(run.timingKind)) throw new Error("Invalid run measurement.");
  return r;
}
export async function loadProcessingReport(request: Record<string, unknown>, preview = false): Promise<ProcessingReport> {
  if(import.meta.env.DEV && preview) return (await import("./deviceProcessingPreview")).previewReport(request);
  const { cloud }=await import("../../../lib/firebase");
  return parseProcessingReport((await cloud.httpsCallable("getDeviceProcessingV1",{timeout:120000})(request)).data);
}
export const phoneModel=(machine:string|null)=>({"iPhone19,2":"iPhone 18","iPhone18,3":"iPhone 17","iPhone14,5":"iPhone 13","iPhone12,1":"iPhone 11"}[machine||""] || machine || "Unknown model");
export const seconds=(ms:number|null)=>ms===null ? "Unavailable" : `${(ms/1000).toFixed(2)} s`;
export const memory=(bytes:number|null)=>bytes===null ? "Unavailable" : `${(bytes/1048576).toFixed(0)} MiB`;
export const timingLabel=(kind:string)=>kind==="processing" ? "Processing" : kind==="runWall" ? "Total run" : "Timing unavailable";
