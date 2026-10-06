import { previewReport } from "./deviceProcessingPreview";
import type { TeamReport, TeamSession, TeamRun } from "./teamProcessing";
import type { ProcessingDrill } from "./deviceProcessing";
// Isolated design fixture, never substituted for a failed production read.
export async function previewTeamReport(eventId:string|null):Promise<TeamReport> {
  const now=Date.now(),start=now-28*60000;
  const event={id:"demo-team-rotation",name:"Four-player station runthrough",status:"live",participantCount:4,createdAt:start-600000,startedAt:start,closedAt:null};
  const base={schemaVersion:1 as const,view:"teamSessions" as const,generatedAt:now,events:[event],hasMore:false,session:null};
  if(!eventId)return base;
  const template=await previewReport({algorithm:"all",drill:"all",startDate:"2026-10-03",endDate:"2026-10-03"});
  const participants=["Player A","Player B","Player C","Player D"].map((name,i)=>({id:`demo-player-${i}`,name,order:i}));
  const plans:[ProcessingDrill,number][][]=[[["jump",3]],[["broadJump",3],["deadballShot",4]],[["sprint",3],["changeOfDirection",3],["dribbling",4]]];
  const rows:TeamRun[]=plans.flatMap((plan,station)=>participants.flatMap((player,p)=>{
    const drills=plan.flatMap(([drill,n])=>Array.from({length:n},()=>drill));
    return drills.flatMap((drill,i)=>{
      if(p===3&&i>drills.length-3)return [];
      const original=template.phones[station];
      const pattern=template.phones[station].cohorts.find(c=>c.drill===drill)!;
      const n=station*100+p*10+i,at=start+((p+station)%4)*6*60000+i*24000+station*9000;
      const duration=[3800,6500,8200][station]+p*800+i*180;
      const id=(prefix:string)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
      const r:TeamRun={runId:id("1"),attemptId:id("2"),retryOf:null,installId:original.installId,originInstallId:original.installId,
        testingEventId:event.id,stationId:`station-${station+1}`,playerDocumentID:player.id,logicalRepId:id("3"),terminalAt:at+duration+300,
        drill,sessionId:null,sessionNumber:1,repNumber:i+1,capturedAt:at-6000,startedAt:at,dateReliable:true,outcome:"valid",mode:"liveCapture",
        algorithmId:pattern.algorithmId,sourceRevision:pattern.sourceRevision,policyHash:"demo",sampling:pattern.sampling,configuration:"Release",build:"31",appVersion:"1.1",machine:original.machine,osVersion:"Preview",
        processingMs:duration,wallMs:duration+300,durationMs:duration,timingKind:"processing",framesDecoded:420+i*100,modelCalls:150+i*30,
        sampledPeakBytes:station===1&&i===2?null:(260+station*75+p*20+i*9)*1048576,minAvailableBytes:1500*1048576,
        thermalStart:p>1?"fair":"nominal",thermalEnd:p===3?"serious":p>1?"fair":"nominal",lowPower:false,capture:pattern.capture,failureStage:null,
        stages:[{id:`${drill}.extract`,kind:"mainPhase",status:"completed",ms:duration-100},{id:`${drill}.math`,kind:"mainPhase",status:"completed",ms:100}],provenance:"syntheticPreview"};
      if(i===1&&p===1&&station>0)return [{...r,runId:id("4"),outcome:station===1?"failed":"partial",terminalAt:at+2500,processingMs:2200,wallMs:2500,failureStage:`${drill}.extract`}, {...r,startedAt:at+18000,terminalAt:at+18000+duration+300,retryOf:id("4")}];
      return [r];
    });
  })).sort((a,b)=>a.stationId.localeCompare(b.stationId)||a.startedAt!-b.startedAt!);
  const completions=rows.filter(r=>r.outcome==="valid").map(r=>({key:r.logicalRepId!,stationId:r.stationId,at:r.terminalAt!,runId:r.runId})).sort((a,b)=>a.at-b.at);
  const stations=plans.map((plan,i)=>{
    const id=`station-${i+1}`,rs=rows.filter(r=>r.stationId===id),perPlayer=plan.reduce((n,[,c])=>n+c,0),success=rs.filter(r=>r.outcome==="valid");
    const players=participants.map(p=>{const completed=success.filter(r=>r.playerDocumentID===p.id).length;return {playerId:p.id,state:completed===perPlayer?"completed":"inProgress",completed,synced:completed,planned:perPlayer};});
    const timedPlayers=players.map(p=>{const pr=rs.filter(r=>r.playerDocumentID===p.playerId),startedAt=Math.min(...pr.map(r=>r.capturedAt)),endedAt=p.state==="completed"?Math.max(...pr.map(r=>r.terminalAt!)):null;return {playerId:p.playerId,startedAt,endedAt,elapsedMs:endedAt===null?null:endedAt-startedAt,complete:endedAt!==null,coverage:{acceptedReps:p.completed,timedReps:p.completed}};});
    const elapsed=timedPlayers.map(p=>p.elapsedMs).filter((n):n is number=>n!==null).sort((a,b)=>a-b),mid=Math.floor(elapsed.length/2);
    const avg=(xs:(number|null)[])=>{const ns=xs.filter((n):n is number=>n!==null);return {count:ns.length,mean:ns.length?ns.reduce((a,b)=>a+b,0)/ns.length:null};};
    const drillTimings=plan.map(([drill])=>{const dr=rs.filter(r=>r.drill===drill),finished=dr.filter(r=>["valid","partial"].includes(r.outcome)),failed=dr.filter(r=>r.outcome==="failed");return {drill,runs:dr.length,finished:finished.length,partial:finished.filter(r=>r.outcome==="partial").length,groups:[{key:drill,installId:rs[0].installId,sourceRevision:dr[0].sourceRevision,configuration:"Release",timingKind:"processing",duration:avg(finished.map(r=>r.processingMs)),processing:avg(finished.map(r=>r.processingMs)),wall:avg(finished.map(r=>r.wallMs)),finished:finished.length,valid:finished.filter(r=>r.outcome==="valid").length,partial:finished.filter(r=>r.outcome==="partial").length,failed:failed.length,failedTiming:avg(failed.map(r=>r.processingMs))}]};});
    return {finishedRuns:rs.filter(r=>["valid","partial"].includes(r.outcome)).length,protocolReps:success.length,validReps:success.length,drillTimings,
      playerTime:{...avg(elapsed),median:elapsed.length?(elapsed.length%2?elapsed[mid]:(elapsed[mid-1]+elapsed[mid])/2):null,min:elapsed.length?elapsed[0]:null,max:elapsed.length?elapsed.at(-1)!:null,eligible:players.length,basis:"firstCaptureToFinalResult" as const,players:timedPlayers},
      id,order:i+1,label:["Vertical jump","Broad jump + kicking","Speed + movement"][i],drills:plan.map(([d])=>d),plannedReps:perPlayer*4,completedPlayers:players.filter(p=>p.state==="completed").length,
      progressReps:success.length,syncedReps:success.length,pendingReps:0,processedReps:success.length,runs:rs.length,failed:i===1?1:0,partial:i===2?1:0,interrupted:0,cancelled:0,
      peakBytes:Math.max(...rs.map(r=>r.sampledPeakBytes||0)),phones:[{installId:rs[0].installId!,current:true,machine:rs[0].machine,runs:rs.length}],players};
  });
  const session:TeamSession={...event,participants,stations,rows,completions,unprocessed:[],window:{start,end:now,lastObserved:Math.max(...rows.map(r=>r.terminalAt!))},
    coverage:{staleSummaries:0,missingRepIdentity:0,attempts:rows.length-2,missingSummaries:0,oldSummaries:0,unassigned:0,unknownPhone:0,missingProcessing:0,missingMemory:4,missingThermal:0,missingCompletionTime:0,reprocessing:0,lastReceivedAt:now-15000}};
  return {...base,session};
}
