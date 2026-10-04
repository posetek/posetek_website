import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {TeamSessionDashboard,PerformanceTimeline,ThroughputTimeline,FailureTimeline} from "./TeamSessionPerformance";
import {previewTeamReport} from "../lib/teamProcessingPreview";
import PlayerStationTimings from "./PlayerStationTimings";
import {metricValue,parseTeamReport} from "../lib/teamProcessing";
describe("team session analytics",()=>{
 it("shows three phones, four players, all metric switches and sync progress",async()=>{
  const s=(await previewTeamReport("demo")).session!;const html=renderToStaticMarkup(<MemoryRouter><TeamSessionDashboard session={s} preview/></MemoryRouter>);
  for(const st of s.stations)expect(html).toContain(st.phones[0].installId);
  for(const p of s.participants)expect(html).toContain(p.name);
  for(const label of ["Processing time","Total run time","Peak memory","Heat","Frame reads","Model calls","Reps synced","Awaiting sync","Reporting coverage"])expect(html).toContain(label);
 });
 it("keeps missing measurements distinct from zero and nominal heat",async()=>{
  const r=(await previewTeamReport("demo")).session!.rows[0];
  expect(metricValue({...r,thermalEnd:"nominal"},"thermal")).toBe(0);
  expect(metricValue({...r,thermalEnd:null},"thermal")).toBeNull();
  expect(metricValue({...r,sampledPeakBytes:null},"memory")).toBeNull();
  expect(metricValue({...r,processingMs:null,wallMs:5000},"processing")).toBeNull();
 });
 it("shared metric chart includes all stations and keyboard-accessible individual runs",async()=>{
  const s=(await previewTeamReport("demo")).session!;const html=renderToStaticMarkup(<PerformanceTimeline session={s} rows={s.rows} metric="processing" onSelect={()=>{}}/>);
  expect((html.match(/href="#team-run-/g)||[]).length).toBe(s.rows.length);expect(html).toContain("across all phones");for(const st of s.stations)expect(html).toContain(st.phones[0].installId);
 });
 it("keeps operational throughput independent of drill chart selection and failed attempts",async()=>{
  const s=(await previewTeamReport("demo")).session!;
  expect(s.completions.length).toBe(s.rows.filter(r=>r.outcome==="valid").length);
  const html=renderToStaticMarkup(<ThroughputTimeline session={s}/>);expect((html.match(/<path/g)||[]).length).toBe(3);
  const failed=renderToStaticMarkup(<FailureTimeline session={s} onSelect={()=>{}}/>);expect((failed.match(/href="#team-run-/g)||[]).length).toBe(2);
 });
 it("rejects malformed or oversized team reports",async()=>{
  const r=await previewTeamReport("demo");expect(parseTeamReport(r)).toBe(r);expect(()=>parseTeamReport({...r,schemaVersion:2})).toThrow();
  expect(()=>parseTeamReport({...r,session:{...r.session,rows:Array(2001).fill(r.session!.rows[0])}})).toThrow();r.session!.rows[0].processingMs=NaN;expect(()=>parseTeamReport(r)).toThrow();
 });
 it("represents an empty station without invented processing times",async()=>{
  const s=(await previewTeamReport("demo")).session!;s.rows=[];s.completions=[];
  const html=renderToStaticMarkup(<PerformanceTimeline session={s} rows={[]} metric="memory" onSelect={()=>{}}/>);expect(html).toContain("No reported measurements");expect(html).not.toContain("NaN");
 });
});

it("puts per-person elapsed time and every drill average on each station card",async()=>{
 const s=(await previewTeamReport("demo")).session!;const html=renderToStaticMarkup(<MemoryRouter><TeamSessionDashboard session={s}/></MemoryRouter>);
 expect((html.match(/Average time \/ player/g)||[]).length).toBe(3);expect((html.match(/Average processing by drill/g)||[]).length).toBe(3);expect(html).toContain("Median");expect(html).toContain("includes pauses between reps");expect(html).toContain("Includes 1 partial results");expect(html).not.toContain("phoneStart=");
});
it("all-timing view retains older total-run observations with their definition",async()=>{
 const s=(await previewTeamReport("demo")).session!,row={...s.rows[0],processingMs:null,wallMs:7000,durationMs:7000,timingKind:"runWall"};
 expect(metricValue(row,"duration")).toBe(7);expect(metricValue(row,"processing")).toBeNull();
 const html=renderToStaticMarkup(<PerformanceTimeline session={s} rows={[row]} metric="duration" onSelect={()=>{}}/>);expect(html).toContain("7.00 Seconds · Total run");expect(html).toContain('fill="none"');
});

it("replaces the all-attempt log with per-player station durations, totals and a bottom timeline",async()=>{
 const s=(await previewTeamReport("demo")).session!,html=renderToStaticMarkup(<MemoryRouter><TeamSessionDashboard session={s}/></MemoryRouter>);
 expect(html).not.toContain("Every processing attempt");expect(html).not.toContain("team-runs");expect(html).toContain("Average full runthrough / player");expect(html).toContain("Full runthrough");expect(html).toContain("Between stations");expect(html).toContain("Time by player and station");
 expect((html.match(/<tr id="player-timing-/g)||[]).length).toBe(4);expect((html.match(/class="team-player-chart-row"/g)||[]).length).toBe(4);expect(html).toContain("3 / 4 players with all stations timed");
});
it("makes unfinished player timing explicit while keeping the player in the table and chart",async()=>{
 const s=(await previewTeamReport("demo")).session!;for(const st of s.stations)delete st.playerTime;
 const html=renderToStaticMarkup(<PlayerStationTimings session={s}/>);expect(html).toContain("0 / 4 players with all stations timed");expect((html.match(/No completed station timing yet/g)||[]).length).toBe(4);expect(html).not.toContain("NaN");expect(html).not.toContain("Infinity");
});
