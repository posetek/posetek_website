// Device performance — one app install's report (plan PROCESSING_PERF_07 §7
// "Device report and attempt detail"). The same filters, summaries and step
// breakdown as the fleet, plus the device header (alias, model, short install
// id, builds, last report, coverage start, Rename), a same-device trend with
// build markers, and Processing / Uploads / Failures rows.
//
// "Captured here" (default) attributes capture, time to result and readiness
// to this install as the recording phone; "Processed or uploaded here" counts
// runs and transfers this install executed, including retries of clips
// recorded elsewhere. The two populations are never added together.

import { useEffect, useId, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  DEVICE_LABEL_MAX, DRILL_LABELS, PARAMS, SAVE_STATE_LABELS, UPLOAD_ROLE_LABELS, describeLoadFailure, detailRequest,
  devicePerformanceSearch, failureExplanation, focusDescription, focusParam, formatBytes, formatCount, formatDateTime, formatDuration,
  isInstallId, label, normalizeDeviceLabel, parseDevicePerformanceQuery, shortInstallId, stageLabel, statView,
  forgetCachedReports, useDevicePerformanceReport, useDevicePerformanceSource, useFocusHeadingOnChange, useScrollMemory,
} from "../lib/devicePerformance";
import type {
  DetailRequestV1, DeviceHeaderV1, DevicePerformanceQuery, DevicePerformanceSource, DeviceReportV1, DeviceSection,
  FailureRowV1, FocusV1, LoadFailure, QueryPatch, ReportState, TrendPointV1, UploadRowV1,
} from "../lib/devicePerformance";
import {
  AttemptList, CoverageNotices, Definitions, FailuresByStep, FilterBar, Icon, LimitedData, LoadError, MeasurementsTable,
  PageHeading, Pager, PartialFailure, PreviewControls, ReportSkeleton, SummaryTiles, WhereTimeGoes,
} from "./DevicePerformance";
import DevicePerformanceAttemptDrawer from "./DevicePerformanceAttemptDrawer";
import "../device-performance.scss";

const loadDevice = (source: DevicePerformanceSource, request: DetailRequestV1) => source.device(request);

function deviceTitle(device: Pick<DeviceHeaderV1, "label" | "machine">): string {
  return device.label ?? (device.machine ? `Unnamed ${device.machine}` : "Unnamed device");
}

export default function DevicePerformanceDetail({ preview = false }: { preview?: boolean }) {
  const { installId = "" } = useParams();
  const location = useLocation(), navigate = useNavigate();
  const query = useMemo(() => parseDevicePerformanceQuery(location.search), [location.search]);
  const scenario = preview ? new URLSearchParams(location.search).get(PARAMS.scenario) : null;
  const source = useDevicePerformanceSource(preview, scenario);
  const valid = isInstallId(installId);
  const request = useMemo(() => detailRequest(installId, query), [installId, query]);
  const shape = useMemo(() => ({ ...request, cursor: null, section: null, focus: null }), [request]);
  const { state, refresh } = useDevicePerformanceReport({ source: valid ? source : null, kind: "device", request, shape, scenario, load: loadDevice });
  useScrollMemory(location.pathname + location.search, state.report !== null);
  useFocusHeadingOnChange(focusParam(query.focus), "dp-matching-heading");
  const title = state.report ? deviceTitle(state.report.device) : null;
  useEffect(() => { document.title = `${title ?? "Device"} | Device performance | PoseTek admin`; }, [title]);

  // The breadcrumb reads the device label from history state; keep it current after load or rename.
  useEffect(() => {
    if (!title) return;
    const previous = location.state as { deviceLabel?: string } | null;
    if (previous?.deviceLabel === title) return;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: { ...(previous ?? {}), deviceLabel: title } });
  }, [title, location.pathname, location.search, location.state, navigate]);

  const update = (patch: QueryPatch) => navigate({ pathname: location.pathname, search: devicePerformanceSearch(location.search, patch) }, { state: location.state });
  const closeDrawer = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1);
    else navigate({ pathname: location.pathname, search: devicePerformanceSearch(location.search, { [PARAMS.attempt]: null }) }, { replace: true, state: location.state });
  };

  if (!valid) {
    return (
      <div className="dp-page">
        <section className="dp-state dp-error" role="alert">
          <Icon name="device_unknown" />
          <h1>No such device</h1>
          <p>“{installId}” is not an app install id. Choose a device from the fleet list.</p>
          <Link className="quiet-button small" to={`/admin/device-performance${location.search}`}>Device performance</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="dp-page">
      <PageHeading report={state.report} loading={state.status === "loading"} onRefresh={refresh}
        title={title ?? `Device ${shortInstallId(installId)}`}
        intro="One app install's measurements. Labels are admin aliases; an install is not proof of a physical phone, and a reinstall starts a new one.">
        {state.report && source && <DeviceHeader device={state.report.device} report={state.report} source={source} onRenamed={() => { forgetCachedReports(); refresh(); }} />}
      </PageHeading>
      {source?.kind === "preview" && <PreviewControls source={source} scenario={scenario} onChange={value => update({ [PARAMS.scenario]: value })} />}
      <AttributionToggle value={query.attribution} onChange={value => update({ [PARAMS.attribution]: value === "origin" ? null : value })} />
      <FilterBar key={`${query.period.startDate}:${query.period.endDate}`} query={query} choices={state.report?.choices ?? null} onChange={update} />
      <DeviceReportView state={state} query={query} search={location.search} locationState={location.state} onChange={update} onRetry={refresh} />
      {query.attempt && source && (
        <DevicePerformanceAttemptDrawer attemptId={query.attempt} source={source} timeZone={query.period.timeZone} scenario={scenario} onClose={closeDrawer} />
      )}
    </div>
  );
}

function AttributionToggle({ value, onChange }: { value: "origin" | "executor"; onChange: (value: "origin" | "executor") => void }) {
  const id = useId();
  return (
    <div className="dp-attribution" role="group" aria-labelledby={id}>
      <span id={id} className="dp-attribution-label">Count what this phone</span>
      <button type="button" aria-pressed={value === "origin"} onClick={() => onChange("origin")}>Captured here</button>
      <button type="button" aria-pressed={value === "executor"} onClick={() => onChange("executor")}>Processed or uploaded here</button>
      <p className="dp-muted">
        {value === "origin"
          ? "Attempts recorded on this phone: time to result, readiness and yield belong to it, wherever a retry ran."
          : "Runs and uploads this phone executed, including retries of clips recorded elsewhere. These are a different population from captured attempts."}
      </p>
    </div>
  );
}

function DeviceHeader({ device, report, source, onRenamed }: { device: DeviceHeaderV1; report: DeviceReportV1; source: DevicePerformanceSource; onRenamed: () => void }) {
  const zone = report.period.timeZone;
  const osVersions = [...new Set(device.builds.flatMap(build => build.osVersions))];
  return (
    <div className="dp-device-head">
      <dl className="dp-fields dp-device-facts">
        <div><dt>Model</dt><dd>{device.machine ?? "Not reported"}</dd></div>
        <div><dt>Install</dt><dd><code title={device.installId}>{shortInstallId(device.installId)}</code></dd></div>
        <div>
          <dt>App versions in this period</dt>
          <dd>
            {device.builds.length ? device.builds.map(build => (
              <span key={build.key} className="dp-build">{build.label}<small> seen {formatDateTime(build.firstSeenAt, zone)} – {formatDateTime(build.lastSeenAt, zone)}</small></span>
            )) : "Not reported"}
          </dd>
        </div>
        <div><dt>iOS</dt><dd>{osVersions.length ? osVersions.join(", ") : "Not reported"}</dd></div>
        <div>
          <dt>Last report</dt>
          <dd>
            {formatDateTime(device.lastReportAt, zone)}
            {device.notRecentlyReporting && <span className="admin-chip warn"><Icon name="schedule" />Not recently reporting</span>}
          </dd>
        </div>
        <div><dt>Collecting since</dt><dd>{formatDateTime(device.collectionStartedAt, zone)}</dd></div>
      </dl>
      <RenameDevice device={device} source={source} onRenamed={onRenamed} />
    </div>
  );
}

function RenameDevice({ device, source, onRenamed }: { device: DeviceHeaderV1; source: DevicePerformanceSource; onRenamed: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(device.label ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<LoadFailure | null>(null);
  const inputId = useId();
  async function save(event: { preventDefault(): void }) {
    event.preventDefault();
    setSaving(true);
    setProblem(null);
    try {
      await source.rename({ installId: device.installId, label: normalizeDeviceLabel(draft), expectedRevision: device.labelRevision });
      setOpen(false);
      onRenamed();
    } catch (error) {
      setProblem(describeLoadFailure(error, "rename"));
    } finally {
      setSaving(false);
    }
  }
  if (!open) {
    return <button className="quiet-button small" type="button" onClick={() => { setDraft(device.label ?? ""); setOpen(true); }}><Icon name="edit" />Rename</button>;
  }
  return (
    <form className="dp-rename" onSubmit={save}>
      <label className="dp-field" htmlFor={inputId}>
        <span>Admin label</span>
        <input id={inputId} value={draft} maxLength={DEVICE_LABEL_MAX} autoComplete="off" autoFocus placeholder="For example, Station 2 phone" onChange={event => setDraft(event.target.value)} />
        <small>An alias for admins, visible only here. Leave empty to remove it. Never use a person's name.</small>
      </label>
      <div className="dp-actions">
        <button className="primary-cta small" type="submit" disabled={saving}>{saving ? "Saving…" : "Save label"}</button>
        <button className="quiet-button small" type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
      </div>
      {problem && <p className="dp-inline-error" role="alert">{problem.title}. {problem.message}</p>}
    </form>
  );
}

// MARK: - Report body (pure; tested with static markup)

const SECTIONS: { key: DeviceSection; label: string; icon: string }[] = [
  { key: "processing", label: "Processing", icon: "memory" },
  { key: "uploads", label: "Uploads", icon: "upload" },
  { key: "failures", label: "Failures", icon: "report" },
];

export function DeviceReportView({ state, query, search, locationState = null, onChange, onRetry }: {
  state: ReportState<DeviceReportV1>; query: DevicePerformanceQuery; search: string; locationState?: unknown; onChange: (patch: QueryPatch) => void; onRetry: () => void;
}) {
  const report = state.report;
  if (!report) {
    return state.status === "error" && state.failure
      ? <LoadError failure={state.failure} onRetry={onRetry} onChange={onChange} query={query} />
      : <ReportSkeleton />;
  }
  const busy = state.status === "loading";
  // A step narrows the Failures rows, a time segment the Processing rows; totals stay whole.
  const onFocus = (focus: FocusV1 | null) => onChange({
    [PARAMS.focus]: focusParam(focus),
    [PARAMS.cursor]: null,
    [PARAMS.section]: focus?.kind === "stage" ? "failures" : focus?.kind === "phase" ? null : query.section,
  });
  const rowsCurrent = report.rows.kind === query.section;
  return (
    <div className="dp-report" aria-busy={busy || undefined}>
      {state.failure && <PartialFailure failure={state.failure} onRetry={onRetry} />}
      <CoverageNotices report={report} query={query} onChange={onChange} />
      <DeviceStatus report={report} />
      {report.coverage.attemptsIndexed === 0
        ? <section className="dp-state"><Icon name="filter_alt_off" /><h2>No reports match these filters</h2><p>This phone sent no matching {query.attribution === "origin" ? "attempts" : "runs or uploads"} from {report.period.startDate} to {report.period.endDate}. This is not a count of zero: an offline phone may have attempts the server has not seen.</p></section>
        : <>
          <SummaryTiles report={report} role={query.filters.uploadRole} onRole={role => onChange({ [PARAMS.uploadRole]: role })} />
          <WhereTimeGoes rows={report.perDrill} report={report} focus={query.focus} onFocus={onFocus} />
          <DeviceTrend points={report.trends} timeZone={report.period.timeZone} />
          <FailuresByStep rows={report.failureStages} focus={query.focus} onFocus={onFocus} title="Failures by step on this phone" />
        </>}
      <section className="admin-card dp-section" aria-labelledby="dp-matching-heading" aria-busy={busy || undefined}>
        <div className="dp-section-head">
          <h2 id="dp-matching-heading" tabIndex={-1}>Attempts on this phone</h2>
          {query.focus && (
            <p className="dp-focus">
              <span>{focusDescription(query.focus)}.</span>
              <button type="button" className="dp-text-button" onClick={() => onFocus(null)}>Show all</button>
            </p>
          )}
          <nav className="dp-tabs" aria-label="Device report sections">
            {SECTIONS.map(section => (
              <Link key={section.key} to={{ search: devicePerformanceSearch(search, { [PARAMS.section]: section.key }) }} state={locationState}
                aria-current={query.section === section.key ? "page" : undefined} className={query.section === section.key ? "active" : undefined}>
                <Icon name={section.icon} />{section.label}
              </Link>
            ))}
          </nav>
        </div>
        {!rowsCurrent
          ? <p className="dp-muted" role="status">{busy ? `Loading ${query.section}…` : `${label({ processing: "Processing", uploads: "Uploads", failures: "Failures" }, query.section)} rows are not loaded.`}</p>
          : report.rows.kind === "processing" ? <AttemptList rows={report.rows.attempts} timeZone={report.period.timeZone} search={search} locationState={locationState} />
          : report.rows.kind === "uploads" ? <UploadRows rows={report.rows.uploads} timeZone={report.period.timeZone} search={search} locationState={locationState} />
          : <FailureRows rows={report.rows.failures} timeZone={report.period.timeZone} search={search} locationState={locationState} />}
        {rowsCurrent && <Pager pagination={report.pagination} cursor={query.cursor} param={PARAMS.cursor} search={search} locationState={locationState} noun={query.section === "processing" ? "attempts" : query.section === "uploads" ? "uploads" : "failures"} busy={busy} />}
      </section>
      <MeasurementsTable report={report} role={query.filters.uploadRole} />
      <Definitions />
    </div>
  );
}

function DeviceStatus({ report }: { report: DeviceReportV1 }) {
  const status = report.device.lastStatus, zone = report.period.timeZone;
  if (!status) return <p className="dp-coverage"><Icon name="info" /><span>This phone has not sent a status report, so its upload backlog is unknown.</span></p>;
  const age = status.oldestPendingRepAgeSeconds;
  return (
    <p className="dp-coverage">
      <Icon name="sync" />
      <span>
        Last status {formatDateTime(status.reportedAt, zone)}: {formatCount(status.repQueuePending)} result uploads waiting{age !== null ? ` (oldest ${formatDuration(age * 1000)})` : ""}, {formatCount(status.repQueueFailed)} failed;
        {" "}{formatCount(status.spoolRecordCount)} performance records not yet sent{status.droppedRecordCount ? `, ${formatCount(status.droppedRecordCount)} dropped because report storage was full` : ""}.
        {" "}Collection {status.collectionCapability === "full" ? "is on" : status.collectionCapability === "partial" ? "is partial" : "is off"} on this phone.
      </span>
    </p>
  );
}

function DeviceTrend({ points, timeZone }: { points: TrendPointV1[]; timeZone: string }) {
  const headingId = useId();
  const typical = points.map(point => { const view = statView(point.timeToResult); return view.kind === "value" ? view : null; });
  const max = Math.max(1, ...typical.map(view => view?.typicalMs ?? 0));
  return (
    <section className="admin-card dp-section" aria-labelledby={headingId}>
      <div className="dp-section-head">
        <h2 id={headingId}>Trend on this phone</h2>
        <p>Typical time to result per day, with the first day a new app version was seen. Attempts with an unreliable phone date are left out. Times are {timeZone.replace("America/", "").replaceAll("_", " ")}.</p>
      </div>
      {!points.some(point => point.attempts) ? <p className="dp-stat-note"><Icon name="remove" /><span>No dated attempts in this period.</span></p> : (
        <div className="dp-table-wrap">
          <table className="dp-table dp-trend">
            <caption className="admin-sr-only">Typical time to result by day</caption>
            <thead><tr><th scope="col">Day</th><th scope="col">Attempts</th><th scope="col">Typical time to result</th><th scope="col">Failed</th></tr></thead>
            <tbody>
              {points.map((point, index) => {
                const view = typical[index];
                return (
                  <tr key={point.date}>
                    <th scope="row">{point.date}{point.newBuilds.map(build => <span key={build} className="admin-chip accent"><Icon name="new_releases" />New version {build}</span>)}</th>
                    <td>{formatCount(point.attempts)}</td>
                    <td>
                      {view ? <span className="dp-trend-cell">
                        <span className="dp-trend-bar" aria-hidden="true" style={{ width: `${(view.typicalMs / max) * 100}%` }} />
                        {formatDuration(view.typicalMs)}{view.limited && <LimitedData />}
                      </span> : <span className="dp-muted">{point.attempts ? "Not measured" : "No attempts"}</span>}
                    </td>
                    <td>{point.knownOutcomes ? `${formatCount(point.failed)} of ${formatCount(point.knownOutcomes)}` : "—"}</td>
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

function attemptLink(search: string, attemptId: string) {
  return { search: devicePerformanceSearch(search, { [PARAMS.attempt]: attemptId }) };
}
const linkState = (locationState: unknown) => ({ ...(typeof locationState === "object" && locationState ? locationState : {}), fromList: true });
const when = (row: { occurredAt: string | null; clockQuality: string }, zone: string) => (row.clockQuality === "reliable" ? formatDateTime(row.occurredAt, zone) : "Date uncertain");

function UploadRows({ rows, timeZone, search, locationState }: { rows: UploadRowV1[]; timeZone: string; search: string; locationState: unknown }) {
  if (!rows.length) return <p className="dp-stat-note"><Icon name="remove" /><span>No uploads in this period.</span></p>;
  return (
    <div className="dp-table-wrap">
      <table className="dp-table dp-uploads">
        <caption className="admin-sr-only">Uploads from this phone</caption>
        <thead><tr><th scope="col">Attempt</th><th scope="col">Role</th><th scope="col">State</th><th scope="col">Size</th><th scope="col">Waiting</th><th scope="col">Transfer time</th><th scope="col">Transfers</th><th scope="col">Cloud save</th></tr></thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.groupId}>
              <th scope="row" data-label="Attempt"><Link to={attemptLink(search, row.attemptId)} state={linkState(locationState)}>{label(DRILL_LABELS, row.drillType)} · {when(row, timeZone)}</Link></th>
              <td data-label="Role">{label(UPLOAD_ROLE_LABELS, row.role)}{row.role === "resultFiles" ? <small>required</small> : <small>optional</small>}</td>
              <td data-label="State">{label(SAVE_STATE_LABELS, row.jobState)}{row.requiredCommitAcknowledged ? " · confirmed" : ""}</td>
              <td data-label="Size">{formatCount(row.objectCount)} files · {formatBytes(row.bytes)}</td>
              <td data-label="Waiting">{row.queueWaitMs === null ? "Not measured" : formatDuration(row.queueWaitMs)}</td>
              <td data-label="Transfer time">{row.transferMs === null ? "Not measured" : formatDuration(row.transferMs)}</td>
              <td data-label="Transfers">{formatCount(row.transferAttempts)}{row.failedTransfers ? ` · ${formatCount(row.failedTransfers)} failed` : ""}{row.lifetimeRetries ? ` · ${formatCount(row.lifetimeRetries)} retries` : ""}</td>
              <td data-label="Cloud save">{row.cloudSaveMs === null ? row.role === "resultFiles" ? "Not measured" : "—" : formatDuration(row.cloudSaveMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FailureRows({ rows, timeZone, search, locationState }: { rows: FailureRowV1[]; timeZone: string; search: string; locationState: unknown }) {
  if (!rows.length) return <p className="dp-stat-note"><Icon name="check_circle" /><span>No failures reported by this phone for these filters.</span></p>;
  return (
    <ul className="dp-failure-rows">
      {rows.map(row => (
        <li key={`${row.attemptId}:${row.processingRunId ?? row.stageId}`}>
          <p>
            {row.confirmed ? <strong><Icon name="dangerous" />Stopped at {stageLabel(row.stageId)}</strong> : <strong><Icon name="help" />Last reported step: {stageLabel(row.stageId)}</strong>}
            <span className="dp-muted"> · {when(row, timeZone)} · {label(DRILL_LABELS, row.drillType)} · {row.build ?? "unknown build"}</span>
          </p>
          <p>{row.confirmed ? failureExplanation(row.failureCode, row.failureLayer) : "The run was interrupted or its end was not reported, so this is the last step the phone reported, not a confirmed failure."}</p>
          <div className="dp-actions">
            <Link className="quiet-button small" to={attemptLink(search, row.attemptId)} state={linkState(locationState)}><Icon name="timeline" />View attempt</Link>
            <details className="dp-code"><summary>Codes</summary><code>{row.stageId}{row.failureCode ? ` · ${row.failureCode}` : ""}{row.failureLayer ? ` · ${row.failureLayer}` : ""}</code></details>
          </div>
        </li>
      ))}
    </ul>
  );
}
