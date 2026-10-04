import type { TeamSession, TeamStation } from "./teamProcessing";

export interface PlayerStationInterval {
  stationId:string; order:number; label:string; startedAt:number|null; endedAt:number|null; elapsedMs:number|null;
  progress:TeamStation["players"][number]|undefined;
}
export interface PlayerRotationTiming {
  playerId:string; name:string; stations:PlayerStationInterval[]; timedStations:number;
  totalMs:number|null; stationMs:number|null; betweenMs:number|null; overlapMs:number|null;
}
const known=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
export function playerStationTimings(session:TeamSession):PlayerRotationTiming[] {
  return session.participants.map(player=>{
    const stations=session.stations.map(station=>{
      const timing=station.playerTime?.players.find(p=>p.playerId===player.id);
      const valid=timing?.complete===true&&known(timing.startedAt)&&known(timing.endedAt)&&known(timing.elapsedMs)
        &&timing.endedAt>=timing.startedAt&&Math.abs(timing.endedAt-timing.startedAt-timing.elapsedMs)<1;
      return {stationId:station.id,order:station.order,label:station.label,
        startedAt:valid?timing.startedAt:null,endedAt:valid?timing.endedAt:null,elapsedMs:valid?timing.elapsedMs:null,
        progress:station.players.find(p=>p.playerId===player.id)};
    });
    const timed=stations.filter(s=>s.elapsedMs!==null);
    if(!stations.length||timed.length!==stations.length)return {playerId:player.id,name:player.name,stations,timedStations:timed.length,totalMs:null,stationMs:null,betweenMs:null,overlapMs:null};
    const ordered=[...timed].sort((a,b)=>a.startedAt!-b.startedAt!);
    let end=ordered[0].startedAt!,covered=0;
    for(const s of ordered){covered+=Math.max(0,s.endedAt!-Math.max(end,s.startedAt!));end=Math.max(end,s.endedAt!);}
    const totalMs=end-ordered[0].startedAt!,stationMs=timed.reduce((n,s)=>n+s.elapsedMs!,0);
    // Do not double-count overlaps as negative transition time. Cross-phone clocks can overlap.
    return {playerId:player.id,name:player.name,stations,timedStations:timed.length,totalMs,stationMs,
      betweenMs:Math.max(0,totalMs-covered),overlapMs:Math.max(0,stationMs-covered)};
  });
}
export function timingAverage(values:(number|null)[]) {
  const measured=values.filter(known);
  return {count:measured.length,mean:measured.length?measured.reduce((a,b)=>a+b,0)/measured.length:null};
}
export function playerDuration(ms:number|null):string {
  if(ms===null)return "Unavailable";
  const seconds=Math.round(ms/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return h?`${h}h ${m}m ${s}s`:m?`${m}m ${s}s`:`${s}s`;
}
