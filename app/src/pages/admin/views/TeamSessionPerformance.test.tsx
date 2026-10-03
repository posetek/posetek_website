import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {MemoryRouter} from "react-router-dom";
import {TeamSessionDashboard,PerformanceTimeline,ThroughputTimeline,FailureTimeline} from "./TeamSessionPerformance";
import {previewTeamReport} from "../lib/teamProcessingPreview";
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
