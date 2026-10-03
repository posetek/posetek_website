import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PhoneOverviewTable, DrillAnalyticsTable } from "./PhonePerformance";
import { previewReport } from "../lib/deviceProcessingPreview";
import { parseProcessingReport } from "../lib/deviceProcessing";
const request={startDate:"2026-10-02",endDate:"2026-10-03",algorithm:"current",drill:"all"};
describe("phone processing comparisons",()=>{
  it("shows every installation as its own row, even without current measurements",async()=>{
    const report=await previewReport(request);report.phones[1].cohorts=[];
    const html=renderToStaticMarkup(<PhoneOverviewTable phones={report.phones} selectedId={report.phones[0].installId} onSelect={()=>{}}/>);
    for(const phone of report.phones)expect(html).toContain(phone.installId);
    expect(html).toContain("iPhone 13");expect(html).toContain("No matching algorithm results");
    expect(html).toContain("Peak memory");expect(html).toContain("Frame reads / calls");
    expect((html.match(/<tr/g)||[]).length).toBe(4);
  });
  it("has exactly one row per drill and keeps missing or partial-only averages unavailable",async()=>{
    const report=await previewReport(request),phone=report.phones[0];phone.cohorts=phone.cohorts.filter(c=>c.drill==="sprint");
    phone.cohorts[0].duration={count:0,mean:null,median:null,p90:null,max:null};phone.cohorts[0].partial=4;phone.cohorts[0].successful=0;
    const html=renderToStaticMarkup(<DrillAnalyticsTable phone={phone}/>);
    expect((html.match(/<tr/g)||[]).length).toBe(7);expect((html.match(/No matching measurements/g)||[]).length).toBe(5);
    expect(html).toContain("Unavailable");expect(html).toContain("4 partial");expect(html).not.toContain("0.00 s");
  });
  it("does not average distinct source cohorts into a single misleading drill number",async()=>{
    const report=await previewReport(request),phone=report.phones[0],c=phone.cohorts[0];phone.cohorts=[c,{...c,key:"older",sourceRevision:"older-source",duration:{...c.duration,mean:30000}}];
    const html=renderToStaticMarkup(<DrillAnalyticsTable phone={phone}/>);
    expect((html.match(/<tr/g)||[]).length).toBe(7);expect(html).toContain("Group 1");expect(html).toContain("Group 2");expect(html).toContain("30.00 s");expect(html).toContain("older-s");
  });
  it("rejects unsupported, oversized or non-finite API measurements",async()=>{
    const report=await previewReport(request);expect(parseProcessingReport(report)).toBe(report);
    expect(()=>parseProcessingReport({...report,schemaVersion:2})).toThrow();
    expect(()=>parseProcessingReport({...report,rows:Array(101).fill({})})).toThrow();
    report.phones[0].cohorts[0].duration.mean=NaN;expect(()=>parseProcessingReport(report)).toThrow();
  });
});
