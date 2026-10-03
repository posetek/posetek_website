import type { ProcessingReport, RunMeasurement, ProcessingCohort } from "./deviceProcessing";

// Development only. No real users, device identities or production fallback.
const ids=["00000000-0000-4000-8000-000000000017","00000000-0000-4000-8000-000000000013","00000000-0000-4000-8000-000000000011"];
export async function previewReport(request:Record<string,unknown>):Promise<ProcessingReport> {
  const now=Date.now(), source="e279f408f3d0b012a5aab25d66dc373269b85de2";
  const drills=["jump","broadJump","deadballShot","sprint","changeOfDirection","dribbling"] as const;
  const runs:RunMeasurement[]=ids.flatMap((id,phone)=>Array.from({length:24},(_,i)=>({
    runId:`10000000-0000-4000-8000-${String(phone*100+i).padStart(12,"0")}`,attemptId:`20000000-0000-4000-8000-${String(phone*100+i).padStart(12,"0")}`,
    retryOf:null,installId:id,originInstallId:id,drill:drills[i%6],sessionId:"10000000000000000000000000000000",sessionNumber:1,repNumber:i+1,
    capturedAt:now-3600000+i*60000,startedAt:now-3600000+i*60000,dateReliable:true,outcome:i===19?"partial":"valid",mode:"liveCapture",
    algorithmId:String(i%6+1).repeat(24),sourceRevision:source,policyHash:"preview",sampling:"scoutThenDense(scout=10,window=0.40s,stride=4,margin=1.00s,ball=all)",
    configuration:"Release",build:"31",appVersion:"1.1",machine:["iPhone18,3","iPhone14,5","iPhone12,1"][phone],osVersion:"iOS preview",
    processingMs:5200+phone*2300+i*80+(i%4)*250,wallMs:5500+phone*2300+i*80,durationMs:5200+phone*2300+i*80+(i%4)*250,timingKind:"processing",
    framesDecoded:1100+i*2,modelCalls:300+i,sampledPeakBytes:(240+phone*30+i)*1048576,minAvailableBytes:(1900-phone*400)*1048576,
    thermalStart:"nominal",thermalEnd:i>18?"fair":"nominal",lowPower:false,capture:{fps:120,width:1280,height:720,durationSeconds:6},failureStage:null,
    stages:[{id:"sprint.extract",parent:null,pass:"sprint.extract",kind:"mainPhase",status:"completed",ms:4900+phone*2300+i*80,frames:1100+i*2,calls:300+i},
      {id:"sprint.math",parent:null,pass:null,kind:"mainPhase",status:"completed",ms:80,frames:null,calls:null}],provenance:"syntheticPreview",
  })));
  const selected=runs.filter(r=>(!request.installId||r.installId===request.installId)&&(request.drill==="all"||r.drill===request.drill)&&(!request.configuration||request.configuration==="all"||r.configuration===request.configuration)&&(request.algorithm==="all"||request.algorithm==="current"||r.algorithmId===request.algorithm));
  const dist=(values:number[])=>{const a=[...values].sort((a,b)=>a-b);return {count:a.length,mean:a.reduce((a,b)=>a+b,0)/a.length||null,median:a[Math.floor(a.length/2)]??null,p90:a[Math.floor((a.length-1)*.9)]??null,max:a.at(-1)??null};};
  const phones=ids.filter(id=>!request.installId||id===request.installId).map(id=>{
    const p=ids.indexOf(id),rows=selected.filter(r=>r.installId===id);
    const cohorts:ProcessingCohort[]=drills.flatMap(drill=>{
      const group=rows.filter(r=>r.drill===drill),r=group[0],valid=group.filter(r=>r.outcome==="valid");
      if(!r)return [];
      return [{key:`${id}-${drill}`,drill,algorithmId:r.algorithmId,sourceRevision:source,sampling:r.sampling,configuration:"Release",timingKind:"processing",capture:r.capture,current:true,builds:["31"],count:group.length,successful:valid.length,failed:0,partial:group.length-valid.length,other:0,duration:dist(valid.map(r=>r.durationMs!)),wall:dist(valid.map(r=>r.wallMs!)),clip:dist(valid.map(r=>r.capture.durationSeconds!)),stages:[{id:`${drill}.extract`,kind:"mainPhase",duration:dist(valid.map(r=>r.processingMs!-100))}],frames:dist(valid.map(r=>r.framesDecoded!)),calls:dist(valid.map(r=>r.modelCalls!)),sampledPeakBytes:Math.max(...group.map(r=>r.sampledPeakBytes!)),memorySamples:group.length,thermalStates:["nominal","fair"],lowPowerRuns:0}];
    });
    return {installId:id,label:["Demo station A","Demo station B","Demo station C"][p],machine:["iPhone18,3","iPhone14,5","iPhone12,1"][p],osVersion:"Preview",lastCapturedAt:now-600000,lastReceivedAt:now-590000,recordedRuns:runs.filter(r=>r.installId===id).length,totals:{framesDecoded:rows.reduce((n,r)=>n+(r.framesDecoded||0),0),modelCalls:rows.reduce((n,r)=>n+(r.modelCalls||0),0)},cohorts};
  });
  return {schemaVersion:1,generatedAt:now,period:{startDate:String(request.startDate),endDate:String(request.endDate),timeZone:"America/Los_Angeles"},current:{label:"1.1 (31)",sourceRevisions:[source]},filters:{},revision:"preview",coverage:{attempts:72,runs:72,unknownDevice:0,timingMissing:0,memoryMissing:0},algorithms:drills.map((drill,i)=>({id:String(i+1).repeat(24),sourceRevision:source,sampling:runs[0].sampling,drill,current:true})),phones,sessions:[{id:"10000000000000000000000000000000",number:1,startedAt:now-3600000,runs:24,drills:[...drills]}],rows:request.installId?selected:[],chart:request.installId?selected:[],totalRows:selected.length,nextCursor:null};
}
