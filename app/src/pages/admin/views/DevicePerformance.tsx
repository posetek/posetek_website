// Device performance — fleet overview (plan PROCESSING_PERF_07 §7 "Fleet
// overview"; definitions §3; contract PROCESSING_PERF_CONTRACTS_V1 §8.4).
//
// All numbers come from the admin-only reporting callables through
// lib/devicePerformance.ts. The page states its scope ("All devices"), keeps
// every filter in the URL (merged, so the admin org/team parameters survive),
// and never shows an unmeasured value as zero. Components exported here are
// shared with the device report (DevicePerformanceDetail.tsx).

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  DEFAULT_TIME_ZONE, DEVICE_SORTS, DEVICE_SORT_LABELS, DRILL_LABELS, DRILL_ROW_LABELS, DRILL_TYPES, FILTER_LABELS,
  LIMITED_DATA_MIN_SAMPLES, MAIN_PHASES, METRIC_DEFINITIONS, NETWORK_INTERFACES, NETWORK_LABELS, OUTCOME_LABELS, PARAMS,
  PERIOD_PRESETS, PHASE_LABELS, PROCESSING_MODES, PROCESSING_MODE_LABELS, RECORDING_MODES, RECORDING_MODE_LABELS,
  SAVE_STATE_LABELS, TIME_ZONES, UPLOAD_ROLES, UPLOAD_ROLE_LABELS, VERDICT_LABELS,
  allocationView, customRangeProblem, dateInZone, devicePath, devicePerformanceSearch, failureRate, fleetRequest,
  focusDescription, focusParam, formatBytes, formatCount, formatDateTime, formatDuration, formatMBps, formatPercent, label,
  missingReasonLabel, parseDevicePerformanceQuery, recoverFromFailure, recoveryLabel, shortInstallId, stageLabel, statView,
  statedScope, uploadSpeed, usableYield, useDevicePerformanceReport, useDevicePerformanceSource, useFocusHeadingOnChange,
  useScrollMemory,
} from "../lib/devicePerformance";
import type {
  AttemptRowV1, ChoicesV1, DevicePerformanceQuery, DevicePerformanceSource, DeviceRowV1, DistributionStatV1, DrillRowV1,
  DrillType, FailureStageRowV1, FleetReportV1, FleetRequestV1, FocusV1, InnerModelRowV1, LoadFailure, MainPhase, MetricGroup,
  PaginationV1, ParamName, QueryPatch, ReportEnvelopeV1, ReportState, UploadRole,
} from "../lib/devicePerformance";
import DevicePerformanceAttemptDrawer from "./DevicePerformanceAttemptDrawer";
import "../device-performance.scss";

const loadFleet = (source: DevicePerformanceSource, request: FleetRequestV1) => source.fleet(request);

export default function DevicePerformance({ preview = false }: { preview?: boolean }) {
  const location = useLocation(), navigate = useNavigate();
  const query = useMemo(() => parseDevicePerformanceQuery(location.search), [location.search]);
  const scenario = preview ? new URLSearchParams(location.search).get(PARAMS.scenario) : null;
  const source = useDevicePerformanceSource(preview, scenario);
  const request = useMemo(() => fleetRequest(query), [query]);
  const shape = useMemo(() => ({ ...request, cursor: null, focus: null, attemptsCursor: null }), [request]);
  // An unusable custom range requests nothing (D-26 G).
  const rangeProblem = query.period.problem;
  const { state, refresh } = useDevicePerformanceReport({ source: rangeProblem ? null : source, preview, kind: "fleet", request, shape, scenario, load: loadFleet });
  useScrollMemory(location.pathname + location.search, state.report !== null);
  useEffect(() => { document.title = "Device performance | PoseTek admin"; }, []);
  useFocusHeadingOnChange(focusParam(query.focus), "dp-matching-heading");

  const update = (patch: QueryPatch) => navigate({ pathname: location.pathname, search: devicePerformanceSearch(location.search, patch) }, { state: location.state });
  const hasCursor = Boolean(query.cursor || query.attemptsCursor);
  const recover = () => recoverFromFailure(state.failure, hasCursor, { refresh, change: update });
  const closeDrawer = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1);
    else navigate({ pathname: location.pathname, search: devicePerformanceSearch(location.search, { [PARAMS.attempt]: null }) }, { replace: true, state: location.state });
  };

  return (
    <div className="dp-page">
      <PageHeading report={rangeProblem ? null : state.report} loading={!rangeProblem && state.status === "loading"} onRefresh={recover}
        title="Device performance"
        intro="How long drills take on each phone, which step takes the time, and where attempts fail. Numbers come from the phones' own measurements." />
      {source?.kind === "preview" && <PreviewControls source={source} scenario={scenario} onChange={value => update({ [PARAMS.scenario]: value })} />}
      <FilterBar key={`${query.period.startDate}:${query.period.endDate}`} query={query} choices={state.report?.choices ?? null} onChange={update} />
      {rangeProblem
        ? <RangeProblem problem={rangeProblem} />
        : <FleetReportView state={state} query={query} search={location.search} locationState={location.state} onChange={update} onRetry={recover} retryLabel={recoveryLabel(state.failure, hasCursor)} />}
      {query.attempt && source && (
        <DevicePerformanceAttemptDrawer attemptId={query.attempt} source={source} timeZone={query.period.timeZone} scenario={scenario} onClose={closeDrawer} />
      )}
    </div>
  );
}

// MARK: - The report body (pure: renders a loaded state; tested with static markup)

export function FleetReportView({ state, query, search, locationState = null, onChange, onRetry, retryLabel = "Retry" }: {
  state: ReportState<FleetReportV1>;
  query: DevicePerformanceQuery;
  search: string;
  locationState?: unknown;
  onChange: (patch: QueryPatch) => void;
  onRetry: () => void;
  retryLabel?: string;
}) {
  const report = state.report;
  if (!report) {
    return state.status === "error" && state.failure
      ? <LoadError failure={state.failure} onRetry={onRetry} retryLabel={retryLabel} onChange={onChange} query={query} />
      : <ReportSkeleton />;
  }
  const busy = state.status === "loading";
  const collected = report.coverage.collectionStartedAt !== null;
  const matching = report.coverage.attemptsIndexed > 0;
  const onFocus = (focus: FocusV1 | null) => onChange({ [PARAMS.focus]: focusParam(focus) });
  return (
    <div className="dp-report" aria-busy={busy || undefined}>
      {state.failure && <PartialFailure failure={state.failure} onRetry={onRetry} retryLabel={retryLabel} />}
      {!collected ? <NotCollectedState /> : !matching ? <NoMatchState report={report} query={query} onChange={onChange} /> : <>
        <CoverageNotices report={report} query={query} onChange={onChange} />
        <SummaryTiles report={report} role={query.filters.uploadRole} onRole={role => onChange({ [PARAMS.uploadRole]: role })} />
        <WhereTimeGoes rows={report.perDrill} report={report} focus={query.focus} onFocus={onFocus} />
        {report.innerModel?.rows.length ? <InnerModelTable rows={report.innerModel.rows} report={report} /> : null}
        <FailuresByStep rows={report.failureStages} focus={query.focus} onFocus={onFocus} />
        {query.focus && <MatchingAttempts report={report} query={query} search={search} locationState={locationState} busy={busy} onClear={() => onFocus(null)} />}
        <DeviceTable key={query.search} report={report} query={query} search={search} locationState={locationState} busy={busy} onChange={onChange} />
        <MeasurementsTable report={report} role={query.filters.uploadRole} />
      </>}
      <Definitions />
    </div>
  );
}

// MARK: - Page chrome

export function Icon({ name }: { name: string }) {
  return <span className="material-symbols-outlined" aria-hidden="true">{name}</span>;
}

export function PageHeading({ report, loading, onRefresh, title, intro, children }: {
  report: ReportEnvelopeV1 | null; loading: boolean; onRefresh: () => void; title: ReactNode; intro: ReactNode; children?: ReactNode;
}) {
  const zone = report?.period.timeZone ?? DEFAULT_TIME_ZONE;
  return (
    <section className="admin-heading dp-heading">
      <div>
        <p className="eyebrow">Device performance</p>
        <h1>{title}</h1>
        <p>{intro}</p>
        <p className="dp-scope">
          <Icon name="devices" />
          <span><strong>All devices.</strong> The organization and team scope does not filter this report: device reports are not linked to teams in this version.</span>
        </p>
        {children}
      </div>
      <div className="admin-heading-actions dp-heading-actions">
        <p className="dp-freshness" aria-live="polite">
          {report
            ? <>
              Showing {report.period.startDate} to {report.period.endDate} ({zone.replace("America/", "").replaceAll("_", " ")}{report.period.dateBasis === "serverReceipt" ? ", by server receipt date" : ""})<br />
              Last report received {formatDateTime(report.freshness.lastReportReceivedAt, zone)}<br />Generated {formatDateTime(report.generatedAt, zone)}
            </>
            : loading ? "Loading the latest complete report…" : ""}
        </p>
        <button className="quiet-button" type="button" onClick={onRefresh} disabled={loading}>
          <Icon name="refresh" />Refresh
        </button>
      </div>
    </section>
  );
}

export function PreviewControls({ source, scenario, onChange }: { source: DevicePerformanceSource; scenario: string | null; onChange: (value: string | null) => void }) {
  return (
    <div className="admin-banner warn dp-preview">
      <Icon name="science" />
      <p><strong>Synthetic preview, no live data.</strong> Every device, attempt and number on this page is invented for design review.</p>
      <label className="dp-field">
        <span>Preview state</span>
        <select value={scenario ?? "normal"} onChange={event => onChange(event.target.value === "normal" ? null : event.target.value)}>
          {(source.scenarios ?? []).map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
        </select>
      </label>
    </div>
  );
}

export function ReportSkeleton() {
  return (
    <div className="dp-skeleton" role="status" aria-busy="true">
      <span className="admin-sr-only">Loading the report</span>
      <div className="dp-tiles" aria-hidden="true">{[0, 1, 2, 3].map(index => <div key={index} className="dp-tile dp-skeleton-block" />)}</div>
      <div className="dp-skeleton-block dp-skeleton-wide" aria-hidden="true" />
      <div className="dp-skeleton-block dp-skeleton-wide" aria-hidden="true" />
      <p className="dp-muted">Loading report…</p>
    </div>
  );
}

export function LoadError({ failure, onRetry, retryLabel = "Retry", onChange, query }: {
  failure: LoadFailure; onRetry: () => void; retryLabel?: string; onChange?: (patch: QueryPatch) => void; query?: DevicePerformanceQuery;
}) {
  return (
    <section className="dp-state dp-error" role="alert">
      <Icon name={failure.problem === "oversized" ? "filter_alt" : failure.problem === "scopeMismatch" ? "rule" : "error"} />
      <h2>{failure.title}</h2>
      <p>{failure.message}</p>
      <div className="dp-actions">
        <button className="primary-cta small" type="button" onClick={onRetry}>{retryLabel}</button>
        {failure.problem === "oversized" && onChange && query && query.period.preset !== 7 && (
          <button className="quiet-button small" type="button" onClick={() => onChange({ [PARAMS.days]: "7" })}>Use the last 7 days</button>
        )}
        {failure.problem === "scopeMismatch" && onChange && query && activeFilterText(query) && (
          <button className="quiet-button small" type="button" onClick={() => onChange(clearFilterPatch())}>Clear filters</button>
        )}
      </div>
      <p className="dp-muted">{retryLabel === "Retry" ? "Your filters are kept." : "Your filters are kept; only the page goes back to the first one."}</p>
    </section>
  );
}

/** A page, focus or section failed; the complete totals already on screen stay. */
export function PartialFailure({ failure, onRetry, retryLabel = "Retry" }: { failure: LoadFailure; onRetry: () => void; retryLabel?: string }) {
  return (
    <div className="admin-banner danger dp-partial" role="alert">
      <Icon name="error" />
      <p><strong>{failure.title}.</strong> {failure.message} The totals shown are still the complete report for these filters; the rows below are from the last page that loaded.</p>
      <button className="quiet-button small" type="button" onClick={onRetry}>{retryLabel}</button>
    </div>
  );
}

/** An unusable custom range in the URL or the form: nothing is requested and nothing is substituted (D-26 G). */
export function RangeProblem({ problem }: { problem: string }) {
  return (
    <section className="dp-state dp-error" role="alert">
      <Icon name="event_busy" />
      <h2>This date range cannot be used</h2>
      <p>{problem} No report is loaded until the range is fixed. Correct the dates above, or choose one of the preset periods.</p>
    </section>
  );
}

function NotCollectedState() {
  return (
    <section className="dp-state">
      <Icon name="cloud_off" />
      <h2>Not collected yet</h2>
      <p>No phone has sent device-performance reports. Collection starts with the first app version that measures these steps. Attempts recorded by older versions are not counted, and nothing here is a zero.</p>
    </section>
  );
}

function NoMatchState({ report, query, onChange }: { report: ReportEnvelopeV1; query: DevicePerformanceQuery; onChange: (patch: QueryPatch) => void }) {
  const zone = report.period.timeZone;
  return (
    <section className="dp-state">
      <Icon name="filter_alt_off" />
      <h2>No reports match these filters</h2>
      <p>
        Phones have reported since {formatDateTime(report.coverage.collectionStartedAt, zone)}, but no attempt from {report.period.startDate} to {report.period.endDate} matches
        {activeFilterText(query) ? ` ${activeFilterText(query)}` : " this period"}. This is not a count of zero attempts: phones that did not report are not included.
      </p>
      <div className="dp-actions">
        {activeFilterText(query) && <button className="quiet-button small" type="button" onClick={() => onChange(clearFilterPatch())}>Clear filters</button>}
        {query.period.preset !== 90 && <button className="quiet-button small" type="button" onClick={() => onChange({ [PARAMS.days]: "90" })}>Use the last 90 days</button>}
      </div>
    </section>
  );
}

// MARK: - Filters

const FILTER_KEYS = ["drill", "recordingMode", "captureBuild", "captureMachine", "processingMode", "executionBuild", "executionMachine", "networkInterface", "payloadSizeBand"] as const;
function clearFilterPatch(): QueryPatch {
  return { ...Object.fromEntries(FILTER_KEYS.map(key => [filterParamName(key), null])), [PARAMS.uploadRole]: null };
}
function filterParamName(key: typeof FILTER_KEYS[number]): ParamName {
  return ({ drill: PARAMS.drill, recordingMode: PARAMS.recordingMode, captureBuild: PARAMS.captureBuild, captureMachine: PARAMS.captureMachine,
    processingMode: PARAMS.processingMode, executionBuild: PARAMS.executionBuild, executionMachine: PARAMS.executionMachine,
    networkInterface: PARAMS.networkInterface, payloadSizeBand: PARAMS.payloadSizeBand } as const)[key];
}
function filterValueLabel(key: typeof FILTER_KEYS[number], value: string, choices: ChoicesV1 | null): string {
  if (key === "drill") return label(DRILL_LABELS, value);
  if (key === "recordingMode") return label(RECORDING_MODE_LABELS, value);
  if (key === "processingMode") return label(PROCESSING_MODE_LABELS, value);
  if (key === "networkInterface") return label(NETWORK_LABELS, value);
  const list = key === "payloadSizeBand" ? choices?.payloadSizeBands : key === "captureBuild" ? choices?.captureBuilds : key === "executionBuild" ? choices?.executionBuilds : key === "captureMachine" ? choices?.captureMachines : choices?.executionMachines;
  return list?.find(row => row.key === value)?.label ?? value;
}
function activeFilterText(query: DevicePerformanceQuery): string {
  const active = FILTER_KEYS.filter(key => query.filters[key] !== null).map(key => `${FILTER_LABELS[key]} ${filterValueLabel(key, query.filters[key] as string, null)}`);
  return active.length ? `the filters ${active.join(", ")}` : "";
}

function ChoiceSelect({ label: text, value, allLabel, options, onChange, hint }: {
  label: string; value: string | null; allLabel: string; options: { key: string; label: string }[]; onChange: (value: string | null) => void; hint?: string;
}) {
  const id = useId();
  const listed = value && !options.some(option => option.key === value) ? [...options, { key: value, label: value }] : options;
  return (
    <label className="dp-field" htmlFor={id}>
      <span>{text}</span>
      <select id={id} value={value ?? ""} onChange={event => onChange(event.target.value || null)} aria-describedby={hint ? `${id}-hint` : undefined}>
        <option value="">{allLabel}</option>
        {listed.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
const enumOptions = (values: readonly string[], labels: Record<string, string>) => values.map(value => ({ key: value, label: labels[value] ?? value }));

export function FilterBar({ query, choices, onChange }: { query: DevicePerformanceQuery; choices: ChoicesV1 | null; onChange: (patch: QueryPatch) => void }) {
  const [customOpen, setCustomOpen] = useState(query.period.preset === "custom");
  const [dates, setDates] = useState({ start: query.period.startDate, end: query.period.endDate });
  // A range from the URL that cannot be used is shown as an error here too, never swapped for a preset.
  const [dateError, setDateError] = useState(query.period.problem ?? "");
  const today = dateInZone(new Date(), query.period.timeZone);
  const filters = query.filters;
  const advanced = [filters.recordingMode, filters.captureMachine, filters.processingMode, filters.executionBuild, filters.executionMachine, filters.networkInterface, filters.payloadSizeBand]
    .filter(value => value !== null).length + (query.dateBasis !== "capture" ? 1 : 0) + (query.period.timeZone !== DEFAULT_TIME_ZONE ? 1 : 0);
  const set = (key: typeof FILTER_KEYS[number]) => (value: string | null) => onChange({ [filterParamName(key)]: value });
  const active = FILTER_KEYS.filter(key => filters[key] !== null);

  function applyCustom(event: { preventDefault(): void }) {
    event.preventDefault();
    const problem = customRangeProblem(dates.start, dates.end, today);
    if (problem) { setDateError(problem); return; }
    setDateError("");
    onChange({ [PARAMS.start]: dates.start, [PARAMS.end]: dates.end });
  }

  return (
    <section className="dp-filters" aria-label="Report filters">
      <div className="dp-filter-row">
        <label className="dp-field">
          <span>Period</span>
          <select value={customOpen || query.period.preset === "custom" ? "custom" : String(query.period.preset)} onChange={event => {
            if (event.target.value === "custom") { setCustomOpen(true); return; }
            setCustomOpen(false);
            onChange({ [PARAMS.days]: event.target.value });
          }}>
            {PERIOD_PRESETS.map(days => <option key={days} value={days}>Last {days} days</option>)}
            <option value="custom">Custom range</option>
          </select>
        </label>
        <ChoiceSelect label="Drill" value={filters.drill} allLabel="All drills" options={enumOptions(DRILL_TYPES, DRILL_LABELS)} onChange={set("drill")} />
        <ChoiceSelect label="Recorded app version" value={filters.captureBuild} allLabel="All versions" options={choices?.captureBuilds ?? []} onChange={set("captureBuild")} />
        <details className="dp-more" open={advanced > 0 ? true : undefined}>
          <summary>More filters{advanced ? ` (${advanced} active)` : ""}</summary>
          <div className="dp-more-body">
            <fieldset>
              <legend>Recording <small>applies to every measurement</small></legend>
              <ChoiceSelect label="Recording mode" value={filters.recordingMode} allLabel="All recording modes" options={enumOptions(RECORDING_MODES, RECORDING_MODE_LABELS)} onChange={set("recordingMode")} />
              <ChoiceSelect label="Recording phone model" value={filters.captureMachine} allLabel="All models" options={choices?.captureMachines ?? []} onChange={set("captureMachine")} />
              <label className="dp-field">
                <span>Date</span>
                <select value={query.dateBasis} onChange={event => onChange({ [PARAMS.dateBasis]: event.target.value })}>
                  <option value="capture">Captured in period</option>
                  <option value="serverReceipt">Received by the server (investigation)</option>
                </select>
              </label>
              <label className="dp-field">
                <span>Time zone</span>
                <select value={query.period.timeZone} onChange={event => onChange({ [PARAMS.timeZone]: event.target.value })}>
                  {TIME_ZONES.map(zone => <option key={zone} value={zone}>{zone.replace("America/", "").replaceAll("_", " ")}</option>)}
                </select>
              </label>
            </fieldset>
            <fieldset>
              <legend>Processing only <small>changes processing time and failures</small></legend>
              <ChoiceSelect label="Processing mode" value={filters.processingMode} allLabel="All modes" options={enumOptions(PROCESSING_MODES, PROCESSING_MODE_LABELS)} onChange={set("processingMode")} />
              <ChoiceSelect label="Processing app version" value={filters.executionBuild} allLabel="All versions" options={choices?.executionBuilds ?? []} onChange={set("executionBuild")} />
              <ChoiceSelect label="Processing phone model" value={filters.executionMachine} allLabel="All models" options={choices?.executionMachines ?? []} onChange={set("executionMachine")} />
            </fieldset>
            <fieldset>
              <legend>Uploads only <small>changes upload measurements; never processing or usable results</small></legend>
              <ChoiceSelect label="Network" value={filters.networkInterface} allLabel="All networks" options={enumOptions(NETWORK_INTERFACES, NETWORK_LABELS)} onChange={set("networkInterface")} />
              <ChoiceSelect label="Payload size" value={filters.payloadSizeBand} allLabel="All sizes" options={choices?.payloadSizeBands ?? []} onChange={set("payloadSizeBand")} />
            </fieldset>
          </div>
        </details>
      </div>
      {(customOpen || query.period.preset === "custom") && (
        <form className="dp-custom" onSubmit={applyCustom}>
          <label className="dp-field"><span>From</span><input type="date" value={dates.start} max={dates.end && dates.end < today ? dates.end : today} onChange={event => setDates(value => ({ ...value, start: event.target.value }))} /></label>
          <label className="dp-field"><span>Through</span><input type="date" value={dates.end} min={dates.start || undefined} max={today} onChange={event => setDates(value => ({ ...value, end: event.target.value }))} /></label>
          <button className="quiet-button small" type="submit">Apply dates</button>
          {dateError && <p className="dp-inline-error" role="alert">{dateError}</p>}
        </form>
      )}
      {active.length > 0 && (
        <div className="dp-active" aria-label="Active filters">
          {active.map(key => (
            <button key={key} type="button" className="admin-chip dp-chip-button" onClick={() => onChange({ [filterParamName(key)]: null })}
              aria-label={`Remove filter ${FILTER_LABELS[key]}: ${filterValueLabel(key, filters[key] as string, choices)}`}>
              {FILTER_LABELS[key]}: {filterValueLabel(key, filters[key] as string, choices)} <Icon name="close" />
            </button>
          ))}
          <button type="button" className="dp-text-button" onClick={() => onChange(clearFilterPatch())}>Clear filters</button>
        </div>
      )}
    </section>
  );
}

// MARK: - Notices

export function CoverageNotices({ report, query, onChange }: { report: ReportEnvelopeV1; query: DevicePerformanceQuery; onChange: (patch: QueryPatch) => void }) {
  const coverage = report.coverage, zone = report.period.timeZone;
  const plural = (count: number, one: string, many = `${one}s`) => `${formatCount(count)} ${count === 1 ? one : many}`;
  const items: { icon: string; text: ReactNode; tone?: "warn" }[] = [];
  if (coverage.attemptsNotCollectedByVersion) {
    const all = coverage.attemptsNotCollectedByVersion >= coverage.attemptsIndexed;
    items.push({ icon: "update", tone: all ? "warn" : undefined, text: `${all ? "Every attempt in this view" : plural(coverage.attemptsNotCollectedByVersion, "attempt")} came from an app version that does not collect these measurements. Those values show as Not collected by this app version, never as zero.` });
  }
  if (coverage.attemptsPartial || coverage.droppedDetailCount) {
    items.push({ icon: "rule", text: `Partial reporting: ${plural(coverage.attemptsPartial, "attempt")} ${coverage.attemptsPartial === 1 ? "is" : "are"} missing some detail${coverage.droppedDetailCount ? `, and phones dropped ${plural(coverage.droppedDetailCount, "optional detail record")} when their report storage was full` : ""}. Missing values are left out, each with a reason.` });
  }
  if (coverage.attemptsDateUncertain) {
    items.push({ icon: "event_busy", text: <>
      {plural(coverage.attemptsDateUncertain, "attempt")} {coverage.attemptsDateUncertain === 1 ? "has" : "have"} an unreliable phone date (Date uncertain) and {coverage.attemptsDateUncertain === 1 ? "is" : "are"} left out of dated trends.{" "}
      <button type="button" className="dp-text-button" onClick={() => onChange({ [PARAMS.dateBasis]: query.dateBasis === "capture" ? "serverReceipt" : null })}>
        {query.dateBasis === "capture" ? "Investigate by server receipt date" : "Back to capture dates"}
      </button>
    </> });
  }
  if (coverage.installsNotRecentlyReporting) {
    items.push({ icon: "schedule", text: `${plural(coverage.installsNotRecentlyReporting, "phone")} ${coverage.installsNotRecentlyReporting === 1 ? "is" : "are"} not recently reporting. That does not mean offline or failing: the last report is shown with its date.` });
  }
  if (coverage.attemptsUnknownDevice) {
    items.push({ icon: "device_unknown", text: `${plural(coverage.attemptsUnknownDevice, "attempt")} came from app versions without an install id and ${coverage.attemptsUnknownDevice === 1 ? "is" : "are"} grouped as Unknown device.` });
  }
  return (
    <section className="dp-notices" aria-label="Coverage">
      <p className="dp-coverage">
        <Icon name="fact_check" />
        <span>
          Based on {plural(coverage.attemptsIndexed, "known attempt")} from {plural(coverage.installsKnown, "app install")} reporting since {formatDateTime(coverage.collectionStartedAt, zone)}.
          {" "}Phones that never reported cannot be counted, so this is not a claim about every phone.
          {report.period.dateBasis === "serverReceipt" && " Dates are server receipt times for investigation, not capture times."}
        </span>
      </p>
      {items.length > 0 && <ul>{items.map((item, index) => <li key={index} className={item.tone === "warn" ? "dp-warn" : undefined}><Icon name={item.icon} /><span>{item.text}</span></li>)}</ul>}
    </section>
  );
}

// MARK: - Summary tiles

function Counts({ stat, noun }: { stat: DistributionStatV1; noun: string }) {
  const topMissing = [...stat.missingReasons].sort((a, b) => b.count - a.count)[0];
  const parts = [`${formatCount(stat.sample)} of ${formatCount(stat.eligible)} ${noun} measured`];
  if (stat.missing) parts.push(`${formatCount(stat.missing)} missing${topMissing ? ` (mostly: ${missingReasonLabel(topMissing.reason).toLowerCase()})` : ""}`);
  if (stat.excluded) parts.push(`${formatCount(stat.excluded)} excluded by definition`);
  return <p className="dp-counts">{parts.join(" · ")}</p>;
}

export function StatBlock({ stat, empty = "No matching measurements in this period" }: { stat: DistributionStatV1; empty?: string }) {
  const view = statView(stat);
  if (view.kind === "none") return <p className="dp-stat-note"><Icon name="remove" /><span>{empty}</span></p>;
  if (view.kind === "missing") return <p className="dp-stat-note"><Icon name="help" /><span>Not measured: {view.reason}</span></p>;
  return (
    <dl className="dp-stat">
      <div><dt>Typical</dt><dd>{formatDuration(view.typicalMs)}</dd></div>
      <div>
        <dt>Slow reps</dt>
        <dd>{view.limited ? <LimitedData /> : formatDuration(view.slowMs)}</dd>
      </div>
    </dl>
  );
}

export function LimitedData({ what = "samples" }: { what?: string }) {
  return <span className="dp-limited"><Icon name="info" />Limited data<span className="admin-sr-only">: fewer than {LIMITED_DATA_MIN_SAMPLES} eligible or measured {what}, so no slow value is shown</span></span>;
}

function ScopeLine({ report, group }: { report: ReportEnvelopeV1; group: MetricGroup }) {
  const keys = statedScope(report, group).filter(key => key !== "uploadRole");
  return <p className="dp-scope-line">{keys.length ? `Filtered by ${keys.map(key => FILTER_LABELS[key]).join(", ")}` : "No filter applies beyond the period"}</p>;
}

export function SummaryTiles({ report, role, onRole }: { report: ReportEnvelopeV1; role: UploadRole; onRole: (role: UploadRole) => void }) {
  const totals = report.totals, zone = report.period.timeZone;
  const rate = failureRate(totals.outcomes), yieldCounts = usableYield(totals.yield);
  const speed = uploadSpeed(totals.uploads, role);
  const tile = (icon: string, title: string, definition: string, body: ReactNode) => (
    <section className="dp-tile" aria-label={title}>
      <header><Icon name={icon} /><h2>{title}</h2></header>
      <p className="dp-tile-def">{definition}</p>
      {body}
    </section>
  );
  const smallPayload = role === "resultFiles" || role === "diagnostics";
  return (
    <div className="dp-tiles">
      {tile("timer", "Time to result", "Video file finalized → result saved on the phone", <>
        <StatBlock stat={totals.timeToResult} />
        <Counts stat={totals.timeToResult} noun="attempts" />
        <ScopeLine report={report} group="capture" />
      </>)}
      {tile("cloud_done", "Cloud save time", "Result queued → result files and records confirmed in the cloud", <>
        <StatBlock stat={totals.cloudSave} />
        <Counts stat={totals.cloudSave} noun="attempts" />
        <p className="dp-counts">
          {totals.cloudBacklog.installsReporting
            ? `Last reported backlog: ${formatCount(totals.cloudBacklog.pendingJobs)} pending, ${formatCount(totals.cloudBacklog.failedJobs)} failed, from ${formatCount(totals.cloudBacklog.installsReporting)} phones (oldest report ${formatDateTime(totals.cloudBacklog.oldestReportAt, zone)}).`
            : "No phone has reported its upload backlog."}
        </p>
        <ScopeLine report={report} group="cloudSave" />
      </>)}
      {tile("upload", "Upload speed", "Payload bytes over measured seconds, one upload role at a time", <>
        <label className="dp-field dp-role">
          <span>Upload role</span>
          <select value={role} onChange={event => onRole(event.target.value as UploadRole)}>
            {UPLOAD_ROLES.map(value => <option key={value} value={value}>{UPLOAD_ROLE_LABELS[value]}</option>)}
          </select>
        </label>
        {!speed ? <p className="dp-stat-note"><Icon name="help" /><span>This report has no {UPLOAD_ROLE_LABELS[role].toLowerCase()} figures.</span></p>
          : !speed.requested ? <p className="dp-stat-note"><Icon name="block" /><span>Not requested: {formatCount(speed.stat.notRequested)} attempts did not ask for {UPLOAD_ROLE_LABELS[role].toLowerCase()} (for example, saving video to the cloud was off). This is not 0 MB/s.</span></p>
          : speed.stat.invocations === 0 ? <p className="dp-stat-note"><Icon name="remove" /><span>No {UPLOAD_ROLE_LABELS[role].toLowerCase()} uploads in this period.</span></p>
          : <>
            <dl className={`dp-stat${smallPayload ? " dp-latency-first" : ""}`}>
              <div><dt>Typical upload time</dt><dd>{uploadTime(speed.stat.duration)}</dd></div>
              <div><dt>Weighted effective throughput</dt><dd>{formatMBps(speed.mbps)}</dd></div>
            </dl>
            <p className="dp-counts dp-caveat"><Icon name="info" />App-observed payload throughput: all successful bytes over all measured seconds. It is not the network's capacity and not the exact bytes sent over the air.</p>
            {smallPayload && <p className="dp-counts">Small files: most of the time is per-upload overhead, so upload time says more than MB/s.</p>}
            <p className="dp-counts">
              {formatCount(speed.stat.succeeded)} of {formatCount(speed.stat.invocations)} uploads succeeded · {formatCount(speed.stat.failed)} failed · {formatCount(speed.stat.cancelled + speed.stat.interrupted)} stopped · {formatCount(speed.stat.pending)} pending
              {speed.stat.excludedZeroOrUnknownDuration ? ` · ${formatCount(speed.stat.excludedZeroOrUnknownDuration)} without a measured duration, left out of the speed` : ""}
              {speed.stat.notRequested ? ` · ${formatCount(speed.stat.notRequested)} attempts did not request it` : ""}
            </p>
          </>}
        <ScopeLine report={report} group="upload" />
      </>)}
      {tile("report", "Processing failures", "Failed runs out of runs with a known outcome", <>
        <div className="dp-tile-part">
          <p className="dp-big">
            <strong>{formatCount(rate.failed)}</strong> <span>of {formatCount(rate.knownOutcomes)} known outcomes</span>
            {rate.knownOutcomes > 0 && <span className="dp-rate">{formatPercent(rate.failed, rate.knownOutcomes)}</span>}
          </p>
          {rate.knownOutcomes > 0 && rate.knownOutcomes < LIMITED_DATA_MIN_SAMPLES && <LimitedData what="outcomes" />}
          <p className="dp-counts">
            Known outcomes include {formatCount(totals.outcomes.partial)} partial and {formatCount(totals.outcomes.noMeasurement)} with no measurement.
            Not counted: {formatCount(rate.excluded.cancelled)} cancelled, {formatCount(rate.excluded.interruptedUnknown)} interrupted, {formatCount(rate.excluded.pending)} pending, {formatCount(rate.excluded.preAdmissionFailures)} stopped before processing started.
          </p>
          <ScopeLine report={report} group="processing" />
        </div>
        {/* Yield is an attempt metric with its own scope (plan 07 §3): run filters do not apply to it (D-26 C). */}
        <div className="dp-tile-part dp-yield" role="group" aria-label="Usable results">
          <p className="dp-counts">
            <strong>Usable results:</strong>{" "}
            {yieldCounts.finalized
              ? `${formatCount(yieldCounts.valid)} of ${formatCount(yieldCounts.finalized)} final attempts (${formatPercent(yieldCounts.valid, yieldCounts.finalized)}), ${formatPercent(totals.yield.firstRunValid, yieldCounts.finalized)} on the first run`
              : "no attempt has a final measurement yet"}
            {`; ${formatCount(yieldCounts.pending)} still recoverable, ${formatCount(yieldCounts.userDiscarded)} discarded by the user.`}
          </p>
          <ScopeLine report={report} group="yield" />
        </div>
      </>)}
    </div>
  );
}

function uploadTime(stat: DistributionStatV1): ReactNode {
  const view = statView(stat);
  if (view.kind === "value") return <>{formatDuration(view.typicalMs)}{view.limited && <LimitedData />}</>;
  return view.kind === "missing" ? "Not measured" : "No measurements";
}

// MARK: - Inner model timing (plan 07 §3; optional response block, D-26 J)

export function InnerModelTable({ rows, report }: { rows: InnerModelRowV1[]; report: ReportEnvelopeV1 }) {
  const headingId = useId();
  const ordered = [...rows].sort((a, b) => DRILL_TYPES.indexOf(a.drillType) - DRILL_TYPES.indexOf(b.drillType) || a.stageId.localeCompare(b.stageId));
  return (
    <section className="admin-card dp-section" aria-labelledby={headingId}>
      <div className="dp-section-head">
        <h2 id={headingId}>Inner model timing: cumulative call time</h2>
        <p>Time spent inside model operations such as loading a model or its first prediction, summed per run over the finished runs in this period. These calls happen inside the steps above, so this time overlaps those steps and is never added to them.</p>
        {/* D-27 (6): shared and processing filters apply, upload filters never. */}
        <ScopeLine report={report} group="processing" />
      </div>
      <div className="dp-table-wrap">
        <table className="dp-table">
          <caption className="admin-sr-only">Cumulative call time per run for each model operation and drill</caption>
          <thead>
            <tr><th scope="col">Drill</th><th scope="col">Operation</th><th scope="col">Inside step</th><th scope="col">Runs</th><th scope="col">Calls</th><th scope="col">Typical per run</th><th scope="col">Slow per run</th></tr>
          </thead>
          <tbody>
            {ordered.map(row => {
              const view = statView(row.cumulativeMs);
              return (
                <tr key={`${row.drillType}:${row.stageId}`}>
                  <th scope="row">{DRILL_LABELS[row.drillType]}</th>
                  <td>{stageLabel(row.stageId)}<small><code>{row.stageId}</code></small></td>
                  <td>{row.parentStageId ? stageLabel(row.parentStageId) : "Top level (not inside a step)"}</td>
                  <td>{formatCount(row.runs)}</td>
                  <td>{formatCount(row.invocations)}</td>
                  <td>{view.kind === "value" ? formatDuration(view.typicalMs) : view.kind === "missing" ? `Not measured: ${view.reason.toLowerCase()}` : "No measurements"}</td>
                  <td>{view.kind === "value" ? view.limited ? <LimitedData /> : formatDuration(view.slowMs) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// MARK: - Where time goes

const phaseLabelFor = (phase: MainPhase | "unattributed") => PHASE_LABELS[phase];

function SegmentBar({ drill, view, maxMs, focus, onFocus }: {
  drill: DrillType; view: NonNullable<ReturnType<typeof allocationView>>; maxMs: number; focus: FocusV1 | null; onFocus: (focus: FocusV1 | null) => void;
}) {
  const segments = view.segments.filter(segment => (segment.meanMs ?? 0) > 0);
  const [chosen, setActive] = useState(0);
  const active = Math.min(chosen, Math.max(0, segments.length - 1));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? segments.length - 1 : (index + step + segments.length) % segments.length;
    setActive(next);
    refs.current[next]?.focus();
  }
  return (
    <div className="dp-bar" role="group" aria-label={`${DRILL_LABELS[drill]}: time by step. Arrow keys move between steps; Enter shows matching attempts.`}>
      {segments.map((segment, index) => {
        const pressed = focus?.kind === "phase" && focus.drill === drill && focus.phase === segment.phase;
        const text = `${phaseLabelFor(segment.phase)}: mean ${formatDuration(segment.meanMs)}`;
        return (
          <button key={segment.phase} ref={element => { refs.current[index] = element; }} type="button"
            className={`dp-seg dp-phase-${segment.phase}`} style={{ width: `${Math.max(0.6, ((segment.meanMs ?? 0) / maxMs) * 100)}%` }}
            tabIndex={index === active ? 0 : -1} aria-pressed={pressed} aria-label={`${text}. Show matching attempts.`} title={text}
            onKeyDown={event => onKeyDown(event, index)}
            onClick={() => { setActive(index); onFocus(pressed ? null : { kind: "phase", drill, phase: segment.phase }); }} />
        );
      })}
    </div>
  );
}

export function WhereTimeGoes({ rows, report, focus, onFocus }: { rows: DrillRowV1[]; report: ReportEnvelopeV1; focus: FocusV1 | null; onFocus: (focus: FocusV1 | null) => void }) {
  const headingId = useId();
  const views = DRILL_TYPES.map(drill => {
    const row = rows.find(entry => entry.drillType === drill) ?? null;
    return { drill, row, view: allocationView(row?.allocation ?? null) };
  });
  const maxMs = Math.max(1, ...views.map(entry => entry.view?.totalMs ?? 0));
  const filteredOut = (drill: DrillType) => report.filters.drill !== null && report.filters.drill !== drill;
  return (
    <section className="admin-card dp-section" aria-labelledby={headingId}>
      <div className="dp-section-head">
        <h2 id={headingId}>Where time goes</h2>
        <p>Mean time in each step between the video file being finalized and the result being saved on the phone, from one group of attempts per drill, so the steps add up to that group's mean. Typical and slow are the median and 90th percentile and are not stacked. Select a step to list matching attempts.</p>
      </div>
      <ul className="dp-legend" aria-label="Steps">
        {[...MAIN_PHASES, "unattributed" as const].map(phase => <li key={phase}><i className={`dp-swatch dp-phase-${phase}`} aria-hidden="true" />{phaseLabelFor(phase)}</li>)}
      </ul>
      <div className="dp-alloc">
        {views.map(({ drill, row, view }) => (
          <div key={drill} className={`dp-alloc-row${filteredOut(drill) ? " dp-dim" : ""}`}>
            <div className="dp-alloc-name">
              <strong>{DRILL_ROW_LABELS[drill]}</strong>
              <span>{filteredOut(drill) ? "Outside the drill filter"
                : !row || !row.attempts ? "No reports in this period"
                : view ? `${formatCount(row.allocation!.cohortSize)} of ${formatCount(row.attempts)} attempts in the breakdown`
                : `${formatCount(row.attempts)} attempts; none with a complete step breakdown`}</span>
            </div>
            {view && !filteredOut(drill)
              ? <SegmentBar drill={drill} view={view} maxMs={maxMs} focus={focus} onFocus={onFocus} />
              : <div className="dp-bar dp-bar-empty" aria-hidden="true" />}
            <div className="dp-alloc-times">
              {row && row.attempts && !filteredOut(drill) ? <StatBlock stat={row.timeToResult} empty="No measured results" /> : <span className="dp-muted">—</span>}
              {view?.inconsistent && <p className="dp-inline-error">The step times exceed the mean; the breakdown is shown without an Unattributed share.</p>}
            </div>
          </div>
        ))}
      </div>
      <details className="dp-table-details">
        <summary>View as a table</summary>
        <div className="dp-table-wrap">
          <table className="dp-table">
            <caption className="admin-sr-only">Mean time by step for each drill</caption>
            <thead>
              <tr>
                <th scope="col">Drill</th>
                <th scope="col">Attempts in breakdown</th>
                {[...MAIN_PHASES, "unattributed" as const].map(phase => <th key={phase} scope="col">{phaseLabelFor(phase)}</th>)}
                <th scope="col">Mean time to result</th>
                <th scope="col">Typical</th>
                <th scope="col">Slow reps</th>
              </tr>
            </thead>
            <tbody>
              {views.map(({ drill, row, view }) => {
                const stat = row ? statView(row.timeToResult) : null;
                return (
                  <tr key={drill}>
                    <th scope="row">{DRILL_ROW_LABELS[drill]}</th>
                    <td>{view ? formatCount(row!.allocation!.cohortSize) : "No reports"}</td>
                    {[...MAIN_PHASES, "unattributed" as const].map(phase => {
                      const segment = view?.segments.find(entry => entry.phase === phase);
                      return <td key={phase}>{segment ? segment.meanMs === null ? "Not measured" : formatDuration(segment.meanMs) : "—"}</td>;
                    })}
                    <td>{view ? formatDuration(row!.allocation!.meanTimeToResultMs) : "—"}</td>
                    <td>{stat?.kind === "value" ? formatDuration(stat.typicalMs) : "—"}</td>
                    <td>{stat?.kind === "value" ? stat.limited ? "Limited data" : formatDuration(stat.slowMs) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

// MARK: - Failures by step

export function FailuresByStep({ rows, focus, onFocus, title = "Failures by step" }: { rows: FailureStageRowV1[]; focus: FocusV1 | null; onFocus: (focus: FocusV1 | null) => void; title?: string }) {
  const headingId = useId();
  const sorted = [...rows].sort((a, b) => b.failures - a.failures || b.entered - a.entered);
  return (
    <section className="admin-card dp-section" aria-labelledby={headingId}>
      <div className="dp-section-head">
        <h2 id={headingId}>{title}</h2>
        <p>Failures attributed to a step out of the runs that entered it. When a phone reported only the last step it reached, that is counted separately and is not a confirmed failure.</p>
      </div>
      {!sorted.length ? <p className="dp-stat-note"><Icon name="check_circle" /><span>No step reported a failure for these filters.</span></p> : (
        <div className="dp-table-wrap">
          <table className="dp-table dp-failures">
            <caption className="admin-sr-only">{title}, with failures out of runs entering each step</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Failed</th>
                <th scope="col">Rate</th>
                <th scope="col">Cancelled</th>
                <th scope="col">Timing unavailable</th>
                <th scope="col">Last reported step only</th>
                <th scope="col"><span className="admin-sr-only">Attempts</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => {
                const pressed = focus?.kind === "stage" && focus.stageId === row.stageId;
                return (
                  <tr key={row.stageId}>
                    <th scope="row" data-label="Step">
                      <span className="dp-step">{stageLabel(row.stageId)}</span>
                      <details className="dp-code"><summary>Details</summary><code>{row.stageId}</code><span>{row.drills.map(drill => label(DRILL_LABELS, drill)).join(", ")}</span></details>
                    </th>
                    <td data-label="Failed">{formatCount(row.failures)} of {formatCount(row.entered)}</td>
                    <td data-label="Rate">{formatPercent(row.failures, row.entered)}</td>
                    <td data-label="Cancelled">{formatCount(row.cancelled)}</td>
                    <td data-label="Timing unavailable">{formatCount(row.unavailable)}</td>
                    <td data-label="Last reported step only">{formatCount(row.lastReportedOnly)}</td>
                    <td data-label="Attempts">
                      <button type="button" className="quiet-button small" aria-pressed={pressed} onClick={() => onFocus(pressed ? null : { kind: "stage", stageId: row.stageId })}>
                        <Icon name={pressed ? "close" : "list"} />{pressed ? "Hide attempts" : "Show attempts"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// MARK: - Attempts and devices

/** Plan 07 §3: "executor shown on retries". Only when the server supplies it (optional field, D-26 D). */
function executorText(row: AttemptRowV1): string | null {
  const executor = row.executorInstallId;
  if (!executor) return null;
  if (executor !== row.originInstallId) return `Processed on another install, ${shortInstallId(executor)}${row.runCount > 1 ? " (retry)" : ""}`;
  return row.runCount > 1 ? `Retried on the recording install, ${shortInstallId(executor)}` : null;
}

export function AttemptList({ rows, timeZone, search, locationState }: { rows: AttemptRowV1[]; timeZone: string; search: string; locationState: unknown }) {
  if (!rows.length) return <p className="dp-stat-note"><Icon name="remove" /><span>No attempts match.</span></p>;
  const baseState = typeof locationState === "object" && locationState ? locationState : {};
  return (
    <ul className="dp-attempts">
      {rows.map(row => {
        const uncertain = row.clockQuality !== "reliable";
        return (
          <li key={row.attemptId}>
            <Link className="dp-attempt-row" to={{ search: devicePerformanceSearch(search, { [PARAMS.attempt]: row.attemptId }) }} state={{ ...baseState, fromList: true }}>
              <span className="dp-attempt-when">
                {uncertain ? <><span className="admin-chip warn"><Icon name="event_busy" />Date uncertain</span><small>Received {formatDateTime(row.receivedAt, timeZone)}</small></> : formatDateTime(row.captureOccurredAt, timeZone)}
              </span>
              <span className="dp-attempt-main">
                <strong>{label(DRILL_LABELS, row.drillType)}{row.recordingMode === "station" ? " · station" : ""}</strong>
                <span>{row.deviceLabel ?? row.machine ?? "Unknown device"}{row.originInstallId ? ` · ${shortInstallId(row.originInstallId)}` : ""} · {row.captureBuild ?? "unknown build"}{row.executionBuilds.some(build => build !== row.captureBuild) ? ` → processed on ${row.executionBuilds.join(", ")}` : ""}</span>
                {executorText(row) && <span className="dp-executor"><Icon name="swap_horiz" />{executorText(row)}</span>}
              </span>
              <span className="dp-attempt-numbers">
                <span className={`admin-chip ${row.measurementVerdict === "valid" ? "accent" : row.measurementVerdict === "invalid" ? "danger" : "warn"}`}>
                  <Icon name={row.measurementVerdict === "valid" ? "check" : row.measurementVerdict === "invalid" ? "close" : "hourglass_empty"} />
                  {VERDICT_LABELS[row.measurementVerdict]}{row.verdictReason ? `: ${label(VERDICT_LABELS, row.verdictReason)}` : ""}
                </span>
                <span>Result {row.timeToResultMs !== null ? formatDuration(row.timeToResultMs) : `not measured (${missingReasonLabel(row.timeToResultMissing).toLowerCase()})`}</span>
                <span>Cloud save {row.cloudSaveMs !== null ? formatDuration(row.cloudSaveMs) : label(SAVE_STATE_LABELS, row.requiredSaveState).toLowerCase()}</span>
              </span>
              <span className="dp-attempt-step">
                {row.failureStageId ? <><Icon name="dangerous" />Stopped at {stageLabel(row.failureStageId)}</>
                  : row.lastReportedStageId ? <><Icon name="help" />Last reported step: {stageLabel(row.lastReportedStageId)}</>
                  : row.runCount > 1 ? <><Icon name="replay" />{row.runCount} runs</> : null}
                {row.completeness !== "complete" && <span className="admin-chip">Partial report</span>}
              </span>
              <Icon name="chevron_right" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Pager({ pagination, cursor, param, search, locationState, noun, busy }: {
  pagination: PaginationV1; cursor: string | null; param: ParamName; search: string; locationState: unknown; noun: string; busy: boolean;
}) {
  if (!pagination.nextCursor && !cursor) return <p className="dp-pager-note">{formatCount(pagination.totalRows)} {noun}</p>;
  return (
    <nav className="dp-pager" aria-label={`${noun} pages`}>
      <span>{formatCount(pagination.totalRows)} {noun}{busy ? " · loading…" : ""}</span>
      {cursor && <Link className="quiet-button small" to={{ search: devicePerformanceSearch(search, { [param]: null }) }} state={locationState}>First page</Link>}
      {pagination.nextCursor && <Link className="quiet-button small" to={{ search: devicePerformanceSearch(search, { [param]: pagination.nextCursor }) }} state={locationState}>Next page<Icon name="chevron_right" /></Link>}
    </nav>
  );
}

function MatchingAttempts({ report, query, search, locationState, busy, onClear }: {
  report: FleetReportV1; query: DevicePerformanceQuery; search: string; locationState: unknown; busy: boolean; onClear: () => void;
}) {
  const current = focusParam(report.focus) === focusParam(query.focus);
  return (
    <section className="admin-card dp-section" aria-labelledby="dp-matching-heading" aria-busy={busy || undefined}>
      <div className="dp-section-head dp-section-head-row">
        <div>
          <h2 id="dp-matching-heading" tabIndex={-1}>Matching attempts</h2>
          <p>{focusDescription(query.focus!)}. Select an attempt to see its timeline.</p>
        </div>
        <button type="button" className="quiet-button small" onClick={onClear}><Icon name="close" />Clear</button>
      </div>
      {!current || !report.attempts
        ? <p className="dp-muted" role="status">{busy ? "Loading matching attempts…" : "Matching attempts are not loaded."}</p>
        : <>
          <AttemptList rows={report.attempts} timeZone={report.period.timeZone} search={search} locationState={locationState} />
          {report.attemptPagination && <Pager pagination={report.attemptPagination} cursor={query.attemptsCursor} param={PARAMS.attemptsCursor} search={search} locationState={locationState} noun="matching attempts" busy={busy} />}
        </>}
    </section>
  );
}

function deviceName(row: Pick<DeviceRowV1, "installId" | "label" | "machine">): string {
  if (!row.installId) return "Unknown device";
  return row.label ?? (row.machine ? `Unnamed ${row.machine}` : "Unnamed device");
}

const SORT_COLUMN: Record<string, string> = { attention: "failures", failureRate: "failures", failureCount: "failures", slowResult: "result", uploadWait: "wait", lastSeen: "seen" };

function DeviceTable({ report, query, search, locationState, busy, onChange }: {
  report: FleetReportV1; query: DevicePerformanceQuery; search: string; locationState: unknown; busy: boolean; onChange: (patch: QueryPatch) => void;
}) {
  const headingId = useId();
  const [draft, setDraft] = useState(query.search);
  const zone = report.period.timeZone;
  const sortColumn = SORT_COLUMN[query.sort];
  const ariaSort = (column: string) => (sortColumn === column ? query.sort === "lastSeen" ? "ascending" : "descending" : undefined);
  return (
    <section className="admin-card dp-section" aria-labelledby={headingId} aria-busy={busy || undefined}>
      <div className="dp-section-head">
        <h2 id={headingId}>Devices</h2>
        <p>Each row is one app install. Labels are admin aliases, not proof of which physical phone it is. Phones with fewer than {LIMITED_DATA_MIN_SAMPLES} measurements stay listed with a Limited data label and are not ranked as slow or failing.</p>
      </div>
      <div className="dp-toolbar">
        <form className="search-field dp-search" role="search" onSubmit={event => { event.preventDefault(); onChange({ [PARAMS.search]: draft.trim() || null }); }}>
          <Icon name="search" />
          <label className="admin-sr-only" htmlFor={`${headingId}-search`}>Search devices by label or model</label>
          <input id={`${headingId}-search`} type="search" value={draft} placeholder="Search label or model" autoComplete="off" onChange={event => setDraft(event.target.value)} />
          <button type="submit" className="dp-text-button">Search</button>
        </form>
        <label className="dp-field">
          <span>Sort devices</span>
          <select value={query.sort} onChange={event => onChange({ [PARAMS.sort]: event.target.value })}>
            {DEVICE_SORTS.map(sort => <option key={sort} value={sort}>{DEVICE_SORT_LABELS[sort]}</option>)}
          </select>
        </label>
      </div>
      {!report.devices.length ? <p className="dp-stat-note"><Icon name="remove" /><span>{query.search ? `No device label or model matches “${query.search}”.` : "No devices reported in this period."}</span></p> : (
        <div className="dp-table-wrap">
          <table className="dp-table dp-devices">
            <caption className="admin-sr-only">Devices, sorted by {DEVICE_SORT_LABELS[query.sort].toLowerCase()}</caption>
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">App build</th>
                <th scope="col">Reports</th>
                <th scope="col" aria-sort={ariaSort("result")}>Result time</th>
                <th scope="col">Cloud save</th>
                <th scope="col" aria-sort={ariaSort("failures")}>Failures</th>
                <th scope="col" aria-sort={ariaSort("wait")}>Upload wait</th>
                <th scope="col" aria-sort={ariaSort("seen")}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {report.devices.map((row, index) => {
                const rate = failureRate(row.outcomes);
                const result = statView(row.timeToResult), save = statView(row.cloudSave), wait = statView(row.uploadWait);
                const short = (view: ReturnType<typeof statView>) => view.kind === "value"
                  ? <>{formatDuration(view.typicalMs)}{view.limited && <LimitedData />}</>
                  : <span className="dp-muted">{view.kind === "missing" ? `Not measured: ${view.reason.toLowerCase()}` : "No measurements"}</span>;
                return (
                  <tr key={row.installId ?? `unknown-${index}`}>
                    <th scope="row" data-label="Device">
                      {row.installId
                        ? <Link to={devicePath(row.installId, search)} state={{ deviceLabel: deviceName(row) }}>{deviceName(row)}</Link>
                        : <span className="dp-unknown"><Icon name="device_unknown" />Unknown device</span>}
                      <small>{row.installId ? `${row.machine ?? "Unknown model"} · install ${shortInstallId(row.installId)}` : "Recorded before install ids existed"}</small>
                    </th>
                    <td data-label="App build">{row.builds.length ? row.builds.map(build => build.label).join(", ") : "Unknown"}{row.builds.length > 1 && <span className="admin-chip">{row.builds.length} builds</span>}</td>
                    <td data-label="Reports">{formatCount(row.attempts)} attempts<small>{formatCount(row.runs)} runs processed here</small></td>
                    <td data-label="Result time">{short(result)}</td>
                    <td data-label="Cloud save">{short(save)}</td>
                    <td data-label="Failures">
                      {rate.knownOutcomes ? <>{formatCount(rate.failed)} of {formatCount(rate.knownOutcomes)}<small>{formatPercent(rate.failed, rate.knownOutcomes)}{rate.knownOutcomes < LIMITED_DATA_MIN_SAMPLES ? " · limited data" : ""}</small></> : <span className="dp-muted">No known outcomes</span>}
                    </td>
                    <td data-label={`Upload wait (${UPLOAD_ROLE_LABELS[query.filters.uploadRole].toLowerCase()})`}>{short(wait)}</td>
                    <td data-label="Last seen">
                      {row.lastReportAt ? formatDateTime(row.lastReportAt, zone) : "No report"}
                      {row.notRecentlyReporting && <span className="admin-chip warn"><Icon name="schedule" />Not recently reporting</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager pagination={report.pagination} cursor={query.cursor} param={PARAMS.cursor} search={search} locationState={locationState} noun="devices" busy={busy} />
    </section>
  );
}

// MARK: - All measurements and definitions

export function MeasurementsTable({ report, role }: { report: ReportEnvelopeV1; role: UploadRole }) {
  const totals = report.totals, upload = totals.uploads.find(row => row.role === role);
  const rows: [string, DistributionStatV1 | undefined][] = [
    ["Time to result", totals.timeToResult],
    ["Ready for next rep", totals.readyForNextRep],
    ["Save confirmed after recording", totals.saveConfirmedAfterRecording],
    [`Processing time: ${OUTCOME_LABELS.valid.toLowerCase()} runs`, totals.processingTime.byOutcome.valid],
    [`Processing time: ${OUTCOME_LABELS.partial.toLowerCase()} runs`, totals.processingTime.byOutcome.partial],
    [`Processing time: ${OUTCOME_LABELS.noMeasurement.toLowerCase()} runs`, totals.processingTime.byOutcome.noMeasurement],
    [`Processing time: ${OUTCOME_LABELS.failed.toLowerCase()} runs`, totals.processingTime.byOutcome.failed],
    ["Processing time: recovery runs", totals.processingTime.recovery],
    ["Cloud save time", totals.cloudSave],
    [`Waiting to upload (${UPLOAD_ROLE_LABELS[role].toLowerCase()})`, upload?.queueWait],
    [`Upload duration (${UPLOAD_ROLE_LABELS[role].toLowerCase()})`, upload?.duration],
  ];
  return (
    <details className="admin-card dp-section dp-measurements">
      <summary><h2>All measurements</h2><span className="dp-muted">Typical, slow and the counts behind each</span></summary>
      <div className="dp-table-wrap">
        <table className="dp-table">
          <caption className="admin-sr-only">All measurements with their sample counts</caption>
          <thead><tr><th scope="col">Measurement</th><th scope="col">Typical</th><th scope="col">Slow reps</th><th scope="col">Measured</th><th scope="col">Missing</th><th scope="col">Excluded</th></tr></thead>
          <tbody>
            {rows.map(([name, stat]) => {
              if (!stat) return <tr key={name}><th scope="row">{name}</th><td colSpan={5}>Not in this report</td></tr>;
              const view = statView(stat);
              return (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{view.kind === "value" ? formatDuration(view.typicalMs) : view.kind === "missing" ? "Not measured" : "No measurements"}</td>
                  <td>{view.kind === "value" ? view.limited ? "Limited data" : formatDuration(view.slowMs) : "—"}</td>
                  <td>{formatCount(stat.sample)} of {formatCount(stat.eligible)}</td>
                  <td>{stat.missing ? `${formatCount(stat.missing)}: ${stat.missingReasons.map(reason => `${missingReasonLabel(reason.reason).toLowerCase()} (${formatCount(reason.count)})`).join("; ")}` : "0"}</td>
                  <td>{formatCount(stat.excluded)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {upload && <p className="dp-counts">{UPLOAD_ROLE_LABELS[role]}: {formatBytes(upload.payloadBytes)} uploaded in {formatDuration(upload.elapsedMs)} of measured transfer time; app retry waiting {formatDuration(upload.knownBackoffMs)}.</p>}
    </details>
  );
}

export function Definitions() {
  return (
    <details className="dp-definitions">
      <summary><Icon name="menu_book" />How these numbers are defined</summary>
      <dl>
        {METRIC_DEFINITIONS.map(definition => <div key={definition.key}><dt>{definition.label}</dt><dd>{definition.definition}</dd></div>)}
      </dl>
    </details>
  );
}
