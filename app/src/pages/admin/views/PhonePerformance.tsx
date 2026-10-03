import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { loadProcessingReport, memory, phoneModel, PROCESSING_DRILLS, seconds, timingLabel } from "../lib/deviceProcessing";
import type { ReactNode } from "react";
import type { ProcessingCohort, ProcessingPhone, ProcessingReport, RunMeasurement } from "../lib/deviceProcessing";
import "../device-performance.scss";
import "../phone-performance.scss";

const day=(date:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const time=(ms:number|null,zone:string)=>ms===null?"Not reported":new Intl.DateTimeFormat("en-US",{timeZone:zone,month:"short",day:"numeric",hour:"numeric",minute:"2-digit",second:"2-digit"}).format(ms);
const integer=(n:number|null)=>n===null?"Unavailable":Math.round(n).toLocaleString();

export default function PhonePerformance({preview=false,compact=false}:{preview?:boolean;compact?:boolean}) {
  const {installId}=useParams(), location=useLocation(), navigate=useNavigate();
  const [reload,setReload]=useState(0),[search,setSearch]=useState("");
  const [selectedPhone,setSelectedPhone]=useState<string|null>(null);
  const [state,setState]=useState<{key:string;report:ProcessingReport|null;error:string|null}>({key:"",report:null,error:null});
  const params=useMemo(()=>new URLSearchParams(location.search),[location.search]);
  const request=useMemo(()=>({installId:compact?null:installId||null,startDate:params.get("phoneStart")||day(new Date(Date.now()-6*86400000)),
    endDate:params.get("phoneEnd")||day(new Date()),timeZone:"America/Los_Angeles",drill:params.get("phoneDrill")||"all",
    algorithm:params.get("phoneAlgorithm")||"current",configuration:params.get("phoneConfiguration")||"all",
    sessionId:compact?null:params.get("phoneSession"),cursor:compact?null:params.get("phoneCursor"),focusRunId:compact?null:params.get("phoneRun")}),[params,installId,compact]);
  const key=JSON.stringify([request,preview,reload]);
  useEffect(()=>{let active=true;loadProcessingReport(request,preview).then(report=>{if(active)setState({key,report,error:null});}).catch(error=>{
    if(active)setState({key,report:null,error:error instanceof Error?error.message:"Could not load phone performance."});
  });return()=>{active=false;};},[key,request,preview]);
  const report=state.key===key?state.report:null,error=state.key===key?state.error:null;
  const change=(patch:Record<string,string|null>)=>{
    const next=new URLSearchParams(location.search);next.delete("phoneCursor");next.delete("phoneRun");
    for(const [k,v] of Object.entries(patch))if(v)next.set(k,v);else next.delete(k);
    navigate({pathname:location.pathname,search:next.toString()});
  };
  const link=(id:string|null,all=false)=>{const next=new URLSearchParams(location.search);next.delete("phoneCursor");next.delete("phoneRun");next.delete("phoneSession");
    if(all)next.set("phoneAlgorithm","all");return `/admin/device-performance${id?`/${id}`:""}?${next}`;};
  useEffect(()=>{
    if(!report || !request.focusRunId)return;
    const element=document.getElementById(`run-${request.focusRunId}`) as HTMLDetailsElement|null;
    if(element){element.open=true;element.scrollIntoView({block:"center"});}
  },[report,request.focusRunId]);
  const device=report?.phones.find(p=>p.installId===installId);
  const selected=report?.phones.filter(p=>`${p.label||""} ${phoneModel(p.machine)} ${p.installId||""}`.toLowerCase().includes(search.toLowerCase()))||[];
  const shown=selected;
  const expandedPhone=shown.find(p=>p.installId===selectedPhone) || shown[0];
  return <section className={`dp-page phone-performance ${compact?"phone-compact":""}`} aria-label="Phone performance">
    <div className="admin-heading dp-heading">
      <div><p className="eyebrow">Device performance · All devices</p>
        {!compact&&installId&&<Link to={link(null)}>← All phones</Link>}
        {compact?<h2>Processing on your phones</h2>:<h1>{installId?device?.label||phoneModel(device?.machine||null):"Phone performance"}</h1>}
        <p>{compact?"Current-algorithm results, with each phone and drill kept separate.":"Measured processing, frame workload and memory from the diagnostic uploads your phones already send."}</p>
        {report&&<p className="dp-muted">Current release: {report.current.label} · Updated {time(report.generatedAt,report.period.timeZone)} · Organization/team selectors do not filter phones.</p>}
      </div><div className="dp-actions"><Link className="quiet-button" to={`/admin/device-performance/team-sessions${preview?"?preview=1":""}`}>Team testing sessions</Link><button className="quiet-button" type="button" onClick={()=>{change({phoneCursor:null});setReload(x=>x+1);}}>Refresh</button>
        {compact&&<Link className="quiet-button" to={link(null)}>View all phones</Link>}</div>
    </div>
    {preview&&<p className="admin-banner warn">Synthetic preview — these are invented measurements for design review.</p>}
    <div className="dp-filter-row">
      <label className="dp-field">From<input type="date" value={request.startDate} onChange={e=>change({phoneStart:e.target.value})}/></label>
      <label className="dp-field">To<input type="date" value={request.endDate} onChange={e=>change({phoneEnd:e.target.value})}/></label>
      <label className="dp-field">Drill<select value={request.drill} onChange={e=>change({phoneDrill:e.target.value,phoneSession:null})}><option value="all">All drills, separately</option>{Object.entries(PROCESSING_DRILLS).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
      <label className="dp-field">Algorithm<select value={request.algorithm} onChange={e=>change({phoneAlgorithm:e.target.value})}><option value="current">Current release algorithm</option><option value="all">All recorded algorithms</option>{report?.algorithms.map(a=><option value={a.id} key={a.id}>{PROCESSING_DRILLS[a.drill]} · {a.sourceRevision?.slice(0,7)||"unknown source"} · {a.sampling?.startsWith("scout")?"sampled":"sampling unreported"}</option>)}</select></label>
      {!compact&&<label className="dp-field">App configuration<select value={request.configuration} onChange={e=>change({phoneConfiguration:e.target.value})}><option value="all">All, kept separate</option><option>Release</option><option>Debug</option></select></label>}
      {!installId&&<label className="dp-field">Find a phone<input type="search" placeholder="Identifier or phone type" value={search} onChange={e=>setSearch(e.target.value)}/></label>}
    </div>
    {error?<div className="dp-state" role="alert"><h3>Could not load phone measurements</h3><p>{error}</p><button className="quiet-button" onClick={()=>{change({phoneCursor:null});setReload(x=>x+1);}}>Retry</button></div>
      :!report?<div className="dp-state" role="status">Loading phone measurements…</div>:<>
        {!shown.length?<div className="dp-state"><h3>No reporting phones found</h3><p>{search?"No phone matches your search.":"No diagnostic summaries have arrived yet. This is not a count of zero processing runs."}</p></div>:
          !installId?<>
            <PhoneOverviewTable phones={shown} selectedId={expandedPhone?.installId||null} onSelect={setSelectedPhone}/>
            {expandedPhone&&<section className="admin-card dp-section phone-selected">
              <div className="phone-card-heading"><div><p className="eyebrow">Selected phone</p><h3>{expandedPhone.installId||"Unknown installation"}</h3><p>{phoneModel(expandedPhone.machine)} · {expandedPhone.recordedRuns} recorded runs</p></div>
                {expandedPhone.installId&&<Link className="quiet-button" to={link(expandedPhone.installId)}>Detailed analytics →</Link>}
              </div>
              <PhoneCard phone={expandedPhone} detail compact={false} href={link(expandedPhone.installId)} allHref={link(expandedPhone.installId,true)} zone={report.period.timeZone}/>
            </section>}
          </>:shown.map(phone=><PhoneCard key={phone.installId||"unknown"} phone={phone} detail compact={false} href={link(phone.installId)} allHref={link(phone.installId,true)} zone={report.period.timeZone}/>)}
        {compact&&selected.length>shown.length&&<Link to={link(null)}>View all {selected.length} phones</Link>}
        {!compact&&installId&&<>
          <section className="admin-card dp-section">
            <div className="dp-section-head"><h2>Within a session</h2><p>Every point is a processing run. Failed and partial runs remain visible. Retries keep their own points.</p></div>
            <label className="dp-field">Session<select value={request.sessionId||""} onChange={e=>change({phoneSession:e.target.value||null})}><option value="">All sessions in this period</option>{report.sessions.map(s=><option key={s.id} value={s.id}>{time(s.startedAt,report.period.timeZone)} · session {s.number??"unknown"} · {s.runs} runs</option>)}</select></label>
            <RunChart runs={report.chart} kind="time" zone={report.period.timeZone} onSelect={id=>change({phoneRun:id})}/>
            <RunChart runs={report.chart} kind="memory" zone={report.period.timeZone} onSelect={id=>change({phoneRun:id})}/>
          </section>
          <section className="admin-card dp-section"><h2>Every processing run</h2><p>{report.totalRows} runs match. Expand a run for its stage timings, frame reads and algorithm details.</p>
            {!report.rows.length?<p>No matching runs. Select “All recorded algorithms” to inspect older builds.</p>:report.rows.map(run=><RunDetail key={run.runId} run={run} zone={report.period.timeZone}/>)}
            {report.nextCursor&&<button className="quiet-button" onClick={()=>change({phoneCursor:report.nextCursor})}>Next 100 runs</button>}
            {(request.cursor||request.focusRunId)&&<button className="quiet-button" onClick={()=>change({phoneCursor:null})}>First page</button>}
          </section>
        </>}
        <p className="dp-muted">{report.coverage.attempts} diagnostic attempts in this period · {report.coverage.unknownDevice} runs without a known executing phone. An app reinstall may create a new phone identity.</p>
        {!compact&&<details className="admin-card dp-section"><summary>What these measurements mean</summary><p>Means and percentiles use successful live runs only. Drill, source algorithm, app configuration, capture format and timing definition are kept separate. Fewer than 20 measurements are marked limited data.</p><p>“Processing” is the phone’s measured processor duration. Older “Total run” measurements include run/journal overhead and use reported start/end times. They are never pooled together. Missing measurements are unavailable, not zero.</p><p>Memory is the largest sampled app footprint, not CPU/GPU utilization or a continuously measured maximum. Frame reads include repeat passes; model calls show actual inference workload. Neither equals unique video frames.</p><p>Current means the explicitly selected release source and sampling policy, not the largest build number or latest upload. Old builds remain visible in “All recorded algorithms”.</p></details>}
      </>}
  </section>;
}

export function PhoneOverviewTable({phones,selectedId,onSelect}:{phones:ProcessingPhone[];selectedId:string|null;onSelect:(id:string|null)=>void}) {
  return <div className="admin-card dp-table-wrap phone-overview-table"><table className="dp-table">
    <caption>Average successful processing time by drill. Select a phone to see its drill analytics below.</caption>
    <thead><tr><th>Phone identifier</th><th>Phone type</th>{Object.entries(PROCESSING_DRILLS).filter(([id])=>id!=="freeRecord").map(([id,label])=><th key={id}>{label}<small>Average</small></th>)}<th>Peak memory</th><th>Frame reads / calls</th><th>Outcomes</th></tr></thead>
    <tbody>{phones.map(p=>{
      const peaks=p.cohorts.map(c=>c.sampledPeakBytes).filter((v):v is number=>v!==null);
      const totals=p.totals;
      return <tr key={p.installId||"unknown"} className={selectedId===p.installId?"phone-row-selected":""}>
        <th scope="row"><button className="dp-text-button phone-identifier" type="button" aria-pressed={selectedId===p.installId} onClick={()=>onSelect(p.installId)}>{p.installId||"Unknown installation"}</button></th>
        <td>{phoneModel(p.machine)}<small>{p.machine||"Model not reported"}</small></td>
        {Object.keys(PROCESSING_DRILLS).filter(id=>id!=="freeRecord").map(id=>{const cohorts=p.cohorts.filter(c=>c.drill===id);return <td key={id}>{cohorts.length?cohorts.map(c=><span className="phone-drill-average" key={c.key}>{seconds(c.duration.mean)}<small>{c.duration.count} runs · {timingLabel(c.timingKind)}{cohorts.length>1?` · ${c.configuration} / ${c.sourceRevision?.slice(0,7)}`:""}</small></span>):<span className="dp-muted">—</span>}</td>;})}
        <td>{memory(peaks.length?Math.max(...peaks):null)}</td>
        <td>{integer(totals?.framesDecoded??null)} / {integer(totals?.modelCalls??null)}<small>Total reported workload</small></td>
        <td>{p.cohorts.reduce((n,c)=>n+c.successful,0)} successful<small>{p.cohorts.reduce((n,c)=>n+c.failed,0)} failed · {p.cohorts.reduce((n,c)=>n+c.partial,0)} partial</small>{!p.cohorts.length&&<small>No matching algorithm results</small>}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function PhoneCard({phone,detail,href,allHref,zone}:{phone:ProcessingPhone;detail:boolean;compact:boolean;href:string;allHref:string;zone:string}) {
  return <article className="admin-card dp-section phone-card">
    <div className="phone-card-heading"><div><h3>{phone.installId?<Link to={href}>{phone.installId||"Unknown installation"}</Link>:"Unknown phone"}</h3><p className="dp-muted">{phoneModel(phone.machine)} · {phone.installId?`install ${phone.installId.slice(0,8)}`:"No install ID recorded"}{detail&&phone.osVersion?` · ${phone.osVersion}`:""}</p></div><p className="dp-muted">Last capture {time(phone.lastCapturedAt,zone)}<br/>{phone.recordedRuns} runs recorded in this period</p></div>
    {!phone.cohorts.length&&<p className="phone-no-current">No results match the selected algorithm and filters. {phone.recordedRuns>0&&<Link to={allHref}>View recorded runs →</Link>}</p>}
    <DrillAnalyticsTable phone={phone}/>
  </article>;
}
export function DrillAnalyticsTable({phone}:{phone:ProcessingPhone}) {
  const drills=Object.entries(PROCESSING_DRILLS).filter(([id])=>id!=="freeRecord"||phone.cohorts.some(c=>c.drill===id));
  return <div className="dp-table-wrap phone-drill-table"><table className="dp-table">
    <caption>One row per drill. Successful live runs determine averages; separate algorithm groups stay separately labeled.</caption>
    <thead><tr><th>Drill</th><th>Average time</th><th>Median / p90</th><th>Longest success</th><th>Total run</th><th>Peak memory</th><th>Frame reads / calls</th><th>Clip / format</th><th>Average stage times</th><th>Heat / power</th><th>Outcomes</th><th>Algorithm / build</th></tr></thead>
    <tbody>{drills.map(([id,label])=>{
      const cohorts=phone.cohorts.filter(c=>c.drill===id);
      const cells=(render:(c:ProcessingCohort)=>ReactNode)=>cohorts.map((c,i)=><div className="phone-cohort-value" key={c.key}>{cohorts.length>1&&<small className="phone-group-label">Group {i+1}</small>}{render(c)}</div>);
      return <tr key={id}><th scope="row">{label}</th>{!cohorts.length?<td colSpan={11} className="dp-muted">No matching measurements</td>:<>
        <td>{cells(c=><>{seconds(c.duration.mean)}<small>{c.duration.count} successes · {timingLabel(c.timingKind)}</small></>)}</td>
        <td>{cells(c=><>{seconds(c.duration.median)}<small>p90: {c.duration.count<20?"Limited data":seconds(c.duration.p90)}</small></>)}</td>
        <td>{cells(c=>seconds(c.duration.max))}</td>
        <td>{cells(c=><>{seconds(c.wall?.mean??null)}<small>Average incl. run overhead</small></>)}</td>
        <td>{cells(c=><>{memory(c.sampledPeakBytes)}<small>{c.memorySamples} sampled runs</small></>)}</td>
        <td>{cells(c=><>{integer(c.frames.mean)} / {integer(c.calls.mean)}<small>Average per measured success</small></>)}</td>
        <td>{cells(c=><>{c.clip?.mean==null?"Unavailable":`${c.clip.mean.toFixed(2)} s`}<small>{c.capture.width??"?"} × {c.capture.height??"?"} · {c.capture.fps??"?"} fps</small></>)}</td>
        <td>{cells(c=>c.stages?.length?c.stages.map(stage=><small key={stage.id}>{stage.kind==="nestedOperation"?"↳ ":""}{stage.id}: {seconds(stage.duration.mean)}</small>):"Unavailable")}</td>
        <td>{cells(c=><>{c.thermalStates.join(", ")||"Not reported"}<small>{c.lowPowerRuns} reported Low Power runs</small></>)}</td>
        <td>{cells(c=><>{c.successful} successful<small>{c.failed} failed · {c.partial} partial · {c.other} other</small></>)}</td>
        <td>{cells(c=><>{c.configuration||"Unknown configuration"} · build {c.builds.join(", ")||"unknown"}<small>{c.sourceRevision?.slice(0,7)||"Unknown source"}</small><small>{c.sampling||"Sampling not reported"}</small></>)}</td>
      </>}</tr>;
    })}</tbody>
  </table><p className="dp-muted">Nested stage times (↳) overlap their parent. Memory includes unsuccessful runs; workload averages use measured successes. Missing data stays unavailable.</p></div>;
}
export function RunChart({runs,kind,zone,onSelect}:{runs:RunMeasurement[];kind:"time"|"memory";zone:string;onSelect?:(id:string)=>void}) {
  const points=runs.filter(r=>(kind==="time"?r.durationMs:r.sampledPeakBytes)!==null);
  const title=kind==="time"?"Processing time across runs":"Sampled peak memory across runs";
  if(!points.length)return <div className="phone-chart"><h3>{title}</h3><p>{runs.length?"This build did not report these measurements.":"No matching runs in this selection."}</p></div>;
  const value=(r:RunMeasurement)=>kind==="time"?r.durationMs!/1000:r.sampledPeakBytes!/1048576;
  const min=Math.min(...points.map(r=>r.startedAt||r.capturedAt)),max=Math.max(min+1,...points.map(r=>r.startedAt||r.capturedAt));
  const top=Math.max(1,...points.map(value))*1.12;
  const x=(r:RunMeasurement)=>60+((r.startedAt||r.capturedAt)-min)/(max-min)*700,y=(r:RunMeasurement)=>190-value(r)/top*155;
  return <div className="phone-chart"><h3>{title}</h3><p className="dp-muted">{points.length} measured runs · {runs.length-points.length} unavailable · {kind==="time"?"Green: processing · blue: older total-run timing · red: unsuccessful":"One sampled peak per run"}</p>
    <svg viewBox="0 0 820 238" role="img" aria-label={`${title}. ${points.length} measurements. Each point opens its processing run.`}>
      {[0,.5,1].map(f=><g key={f}><line x1="60" x2="760" y1={190-f*155} y2={190-f*155} className="phone-grid"/><text x="53" y={194-f*155} textAnchor="end">{(top*f).toFixed(kind==="time"?1:0)}</text></g>)}
      <text x="60" y="18">{kind==="time"?"Seconds":"MiB"}</text><text x="60" y="218">{time(min,zone)}</text><text x="760" y="218" textAnchor="end">{time(max,zone)}</text>
      {points.map(r=><a href={`#run-${r.runId}`} onClick={event=>{if(onSelect){event.preventDefault();onSelect(r.runId);}}} key={r.runId} aria-label={`${PROCESSING_DRILLS[r.drill]} ${r.outcome}, ${kind==="time"?seconds(r.durationMs):memory(r.sampledPeakBytes)}`}><circle cx={x(r)} cy={y(r)} r="5" className={r.outcome!=="valid"?"phone-dot-failed":r.timingKind==="runWall"?"phone-dot-wall":"phone-dot"}><title>{time(r.startedAt||r.capturedAt,zone)} · {PROCESSING_DRILLS[r.drill]} · {r.outcome} · {kind==="time"?`${timingLabel(r.timingKind)} ${seconds(r.durationMs)}`:memory(r.sampledPeakBytes)}</title></circle></a>)}
    </svg><p className="dp-muted">Dots are individual observations; gaps are not interpolated. Exact values and stages are in the run table.</p>
  </div>;
}
function RunDetail({run:r,zone}:{run:RunMeasurement;zone:string}) {
  return <details className="phone-run" id={`run-${r.runId}`}><summary><span>{time(r.startedAt||r.capturedAt,zone)} · {PROCESSING_DRILLS[r.drill]} · rep {r.repNumber??"?"}</span><strong>{seconds(r.durationMs)}</strong><span>{timingLabel(r.timingKind)} · {r.outcome}{r.retryOf?" · retry":""}</span></summary>
    <dl className="dp-fields"><dt>Processing / total run</dt><dd>{seconds(r.processingMs)} / {seconds(r.wallMs)}</dd><dt>Frame reads / model calls</dt><dd>{integer(r.framesDecoded)} / {integer(r.modelCalls)}</dd><dt>Sampled peak / minimum available memory</dt><dd>{memory(r.sampledPeakBytes)} / {memory(r.minAvailableBytes)}</dd><dt>Heat / Low Power Mode</dt><dd>{r.thermalStart||"Unknown"} → {r.thermalEnd||"Unknown"} · {r.lowPower===null?"Unknown":r.lowPower?"On":"Off"}</dd><dt>Clip</dt><dd>{r.capture.durationSeconds?.toFixed(2)??"?"} s · {r.capture.fps??"?"} fps · {r.capture.width??"?"} × {r.capture.height??"?"}</dd><dt>Source / build</dt><dd>{r.sourceRevision||"Unknown"} · {r.configuration||"Unknown"} {r.appVersion} ({r.build})</dd><dt>Sampling policy</dt><dd>{r.sampling||"Not reported"}</dd><dt>Attempt / run</dt><dd>{r.attemptId}<br/>{r.runId}</dd></dl>
    {r.failureStage&&<p>Failed at {r.failureStage}</p>}
    <div className="dp-table-wrap"><table className="dp-table"><caption>Recorded stages; nested operations overlap their parent and must not be added to it.</caption><thead><tr><th>Stage</th><th>Time</th><th>Frame reads</th><th>Model calls</th><th>Status</th></tr></thead><tbody>{r.stages?.map((s,i)=><tr key={`${s.id}-${i}`}><th>{s.kind==="nestedOperation"?"↳ ":""}{s.id}</th><td>{seconds(s.ms)}</td><td>{integer(s.frames)}</td><td>{integer(s.calls)}</td><td>{s.status}</td></tr>)}</tbody></table></div>
  </details>;
}
