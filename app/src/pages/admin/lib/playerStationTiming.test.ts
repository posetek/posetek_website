import {describe,it,expect} from "vitest";
import {playerStationTimings,timingAverage,playerDuration} from "./playerStationTiming";
import {previewTeamReport} from "./teamProcessingPreview";
async function fixture(intervals:[number,number][]) {
  const s=(await previewTeamReport("demo")).session!;s.participants=s.participants.slice(0,1);
  s.stations.forEach((st,i)=>{st.playerTime!.players=[{playerId:s.participants[0].id,startedAt:intervals[i][0],endedAt:intervals[i][1],elapsedMs:intervals[i][1]-intervals[i][0],complete:true,coverage:{acceptedReps:3,timedReps:3}}];});
  return s;
}
describe("player station timing",()=>{
 it("uses each player's first capture to last result, with inter-station gaps kept separate",async()=>{
  const s=await fixture([[1000,11000],[21000,41000],[46000,76000]]),p=playerStationTimings(s)[0];
  expect(p.totalMs).toBe(75000);expect(p.stationMs).toBe(60000);expect(p.betweenMs).toBe(15000);expect(p.overlapMs).toBe(0);
 });
 it("follows capture order even when a player visits station three first",async()=>{
  const s=await fixture([[46000,76000],[21000,41000],[1000,11000]]),p=playerStationTimings(s)[0];
  expect(p.totalMs).toBe(75000);expect(p.betweenMs).toBe(15000);
 });
 it("never reports a finished total or an average for an incomplete player",async()=>{
  const s=await fixture([[1000,11000],[21000,41000],[46000,76000]]);s.stations[1].playerTime!.players[0].complete=false;
  const p=playerStationTimings(s)[0];expect(p.timedStations).toBe(2);expect(p.totalMs).toBeNull();expect(p.stationMs).toBeNull();expect(p.betweenMs).toBeNull();expect(timingAverage([p.totalMs,10000])).toEqual({count:1,mean:10000});
 });
 it("handles missing, nonfinite and inconsistent timing without inventing an interval",async()=>{
  for(const patch of [{startedAt:null},{elapsedMs:NaN},{endedAt:500},{elapsedMs:12000}]){
   const s=await fixture([[1000,11000],[21000,41000],[46000,76000]]);Object.assign(s.stations[0].playerTime!.players[0],patch);
   expect(playerStationTimings(s)[0].totalMs).toBeNull();expect(playerStationTimings(s)[0].stations[0].elapsedMs).toBeNull();
  }
  const s=await fixture([[1000,11000],[21000,41000],[46000,76000]]);delete s.stations[0].playerTime;expect(playerStationTimings(s)[0].timedStations).toBe(2);
 });
 it("accounts for overlapping phone clocks with interval union, not negative gaps",async()=>{
  const s=await fixture([[1000,21000],[11000,31000],[41000,51000]]),p=playerStationTimings(s)[0];
  expect(p.totalMs).toBe(50000);expect(p.stationMs).toBe(50000);expect(p.betweenMs).toBe(10000);expect(p.overlapMs).toBe(10000);
 });
 it("retains recorded zero values and formats long durations as durations, not clock times",()=>{
  expect(timingAverage([null,0,2000])).toEqual({count:2,mean:1000});expect(timingAverage([])).toEqual({count:0,mean:null});
  expect(playerDuration(70103)).toBe("1m 10s");expect(playerDuration(4957589)).toBe("1h 22m 38s");expect(playerDuration(0)).toBe("0s");expect(playerDuration(null)).toBe("Unavailable");
 });
});
