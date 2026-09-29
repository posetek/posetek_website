// One attempt's processing and upload timeline (plan PROCESSING_PERF_07 §7
// "Attempt detail"). Opened by the ?attempt=<id> query parameter, so it is
// shareable and Back closes it.
//
// - Lanes are aligned only within one app launch; separate launches are
//   separate segments with an explicit unknown gap (contract §5).
// - "Stopped here" marks a known failure only; an interruption shows "Last
//   reported step".
// - No video is loaded and no Storage URL is shown: evidence is listed by its
//   exact ids with an honest availability state.
// - Focus is trapped while open, Escape closes, and focus returns to the
//   element that opened it.

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  DRILL_LABELS, EVIDENCE_LABELS, NETWORK_LABELS, OUTCOME_LABELS, RECORDING_MODE_LABELS, SAVE_STATE_LABELS, UPLOAD_ROLE_LABELS,
  VERDICT_LABELS, attemptTimeline, describeLoadFailure, failureExplanation, focusTrapTarget, formatBytes, formatCount,
  formatDateTime, formatDuration, formatMBps, label, missingReasonLabel, shortInstallId, stageLabel, transferSpeedMBps,
} from "../lib/devicePerformance";
import type {
  AttemptDetailV1, DevicePerformanceSource, LoadFailure, PerformanceRecordV1, PlatformRefV1, RunSummaryRecordV1,
  TimelineBar, TimelineLane, TimelineSegment, TransferRecordV1,
} from "../lib/devicePerformance";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";

type DrawerState =
  | { status: "loading" }
  | { status: "error"; failure: LoadFailure }
  | { status: "ready"; detail: AttemptDetailV1; more: { status: "idle" | "loading" } | { status: "error"; failure: LoadFailure } };

export default function DevicePerformanceAttemptDrawer({ attemptId, source, timeZone, scenario = null, onClose }: {
  attemptId: string; source: DevicePerformanceSource; timeZone: string; scenario?: string | null; onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const titleId = useId();
  const [state, setState] = useState<{ key: string; value: DrawerState }>({ key: attemptId, value: { status: "loading" } });
  const [retry, setRetry] = useState(0);
  const current: DrawerState = state.key === attemptId ? state.value : { status: "loading" };
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    let live = true;
    source.attempt({ attemptId, cursor: null }).then(
      detail => { if (live) setState({ key: attemptId, value: { status: "ready", detail, more: { status: "idle" } } }); },
      error => { if (live) setState({ key: attemptId, value: { status: "error", failure: describeLoadFailure(error, "attempt") } }); },
    );
    return () => { live = false; };
  }, [attemptId, source, scenario, retry]);

  // Open: lock page scroll and focus the close button. Close: restore both.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      const target = opener && opener.isConnected && opener !== document.body ? opener : document.querySelector<HTMLElement>(".dp-page h1");
      if (target && !target.hasAttribute("tabindex") && target.tagName === "H1") target.setAttribute("tabindex", "-1");
      target?.focus();
    };
  }, []);

  function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !dialog.current) return;
    const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.offsetParent !== null || element === document.activeElement);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const atEdge = index === -1 || (event.shiftKey ? index === 0 : index === items.length - 1);
    if (!atEdge) return;
    const next = focusTrapTarget(index, items.length, event.shiftKey);
    if (next < 0) return;
    event.preventDefault();
    items[next].focus();
  }

  function loadMore(detail: AttemptDetailV1) {
    const cursor = detail.transferPagination.nextCursor;
    if (!cursor) return;
    setState({ key: attemptId, value: { status: "ready", detail, more: { status: "loading" } } });
    source.attempt({ attemptId, cursor }).then(
      page => setState(previous => previous.key !== attemptId ? previous : { key: attemptId, value: { status: "ready", more: { status: "idle" }, detail: { ...detail, transfers: [...detail.transfers, ...page.transfers], transferPagination: page.transferPagination } } }),
      error => setState(previous => previous.key !== attemptId ? previous : { key: attemptId, value: { status: "ready", detail, more: { status: "error", failure: describeLoadFailure(error, "attempt") } } }),
    );
  }

  return (
    <div className="dp-drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialog} className="dp-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapTab}>
        <header className="dp-drawer-head">
          <div>
            <p className="eyebrow">Attempt</p>
            <h2 id={titleId}>{current.status === "ready" ? attemptTitle(current.detail) : "Attempt timeline"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close attempt timeline" data-autofocus onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        {current.status === "loading" && <p className="dp-muted" role="status">Loading this attempt…</p>}
        {current.status === "error" && (
          <div className="dp-state dp-error" role="alert">
            <h3>{current.failure.title}</h3>
            <p>{current.failure.message}</p>
            <p className="dp-muted">The report behind this panel is unchanged.</p>
            <button className="primary-cta small" type="button" onClick={() => { setState({ key: attemptId, value: { status: "loading" } }); setRetry(value => value + 1); }}>Retry</button>
          </div>
        )}
        {current.status === "ready" && (
          <AttemptDetailView detail={current.detail} timeZone={timeZone} more={current.more.status === "error" ? current.more.failure : current.more.status}
            onLoadMore={() => loadMore(current.detail)}
            onRestart={() => { setState({ key: attemptId, value: { status: "loading" } }); setRetry(value => value + 1); }} />
        )}
      </aside>
    </div>
  );
}

function attemptTitle(detail: AttemptDetailV1): string {
  const drill = detail.attempt?.drillType ?? detail.runs[0]?.drillType ?? null;
  return drill ? `${label(DRILL_LABELS, drill)} attempt` : "Attempt";
}

// MARK: - Detail (pure; tested with static markup)

const platformText = (platform: PlatformRefV1 | null) => (platform ? `${platform.appVersion} (${platform.build}) on ${platform.machine}` : "not reported");
function missingFor(record: PerformanceRecordV1<string, unknown> | null, pointer: string): string {
  const reason = record?.missingReasons.find(row => row.field === pointer)?.reason;
  return reason ? missingReasonLabel(reason) : "Not reported";
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return <div><dt>{name}</dt><dd>{children}</dd></div>;
}

export function AttemptDetailView({ detail, timeZone, more = "idle", onLoadMore, onRestart }: {
  detail: AttemptDetailV1; timeZone: string; more?: "idle" | "loading" | LoadFailure; onLoadMore?: () => void; onRestart?: () => void;
}) {
  const attempt = detail.attempt;
  const timeline = attemptTimeline(detail);
  const verdict = attempt?.body.measurementVerdict ?? null;
  const uncertain = attempt ? attempt.clockQuality !== "reliable" : false;
  const span = (name: "timeToResultMs" | "readyForNextRepMs" | "saveConfirmedAfterRecordingMs") => {
    const value = attempt?.body.spans[name] ?? null, sleep = attempt?.body.continuousSpans[name] ?? null;
    if (value === null) return <span className="dp-muted">Not measured: {missingFor(attempt, `/spans/${name}`).toLowerCase()}</span>;
    return <>{formatDuration(value)}{sleep !== null && sleep - value > 1 ? <small> ({formatDuration(sleep)} including device sleep)</small> : null}</>;
  };
  const evaluation = [attempt, ...detail.runs].some(record => record?.origin === "evaluation");
  return (
    <div className="dp-attempt-detail">
      <div className="admin-row-meta dp-attempt-chips">
        {verdict && <span className={`admin-chip ${verdict === "valid" ? "accent" : verdict === "invalid" ? "danger" : "warn"}`}>
          <span className="material-symbols-outlined" aria-hidden="true">{verdict === "valid" ? "check" : verdict === "invalid" ? "close" : "hourglass_empty"}</span>
          {VERDICT_LABELS[verdict]}{attempt?.body.verdictReason ? `: ${label(VERDICT_LABELS, attempt.body.verdictReason)}` : ""}
        </span>}
        {attempt?.recordingMode && <span className="admin-chip">{label(RECORDING_MODE_LABELS, attempt.recordingMode)}</span>}
        {attempt && attempt.completeness !== "complete" && <span className="admin-chip warn">Partial report</span>}
        {evaluation && <span className="admin-chip danger">Evaluation record: never part of fleet numbers</span>}
        {!attempt && <span className="admin-chip warn">The attempt summary has not arrived yet</span>}
      </div>

      <dl className="dp-fields">
        <Field name="Recorded">{uncertain ? <>Date uncertain <small>(phone clock {attempt?.clockQuality}); first received {formatDateTime(detail.receivedAt.firstReceivedAtServer, timeZone)}</small></> : formatDateTime(attempt?.captureOccurredAtClient ?? null, timeZone)}</Field>
        <Field name="Recording phone">{!attempt ? "Device not yet reported" : detail.devices.find(device => device.installId === attempt.originInstallId)?.label ?? attempt.originPlatform?.machine ?? (attempt.originInstallId ? "Unnamed device" : "Unknown device")}{attempt?.originInstallId ? ` · install ${shortInstallId(attempt.originInstallId)}` : ""}</Field>
        <Field name="Recorded with">{platformText(attempt?.originPlatform ?? null)}</Field>
        <Field name="Time to result">{span("timeToResultMs")}</Field>
        <Field name="Ready for next rep">{span("readyForNextRepMs")}</Field>
        <Field name="Save confirmed after recording">{span("saveConfirmedAfterRecordingMs")}</Field>
        {attempt && <Field name="Saving">{`Required results ${label(SAVE_STATE_LABELS, attempt.body.requiredSaveState).toLowerCase()} · sidecar ${label(SAVE_STATE_LABELS, attempt.body.sidecarState).toLowerCase()} · video archive ${label(SAVE_STATE_LABELS, attempt.body.archiveState).toLowerCase()}`}</Field>}
      </dl>

      <section className="dp-drawer-section" aria-label="Timeline">
        <h3>Timeline</h3>
        <p className="dp-muted">Steps are drawn end to end in the order they started within one app launch. Steps inside another step (model loads, speech) are listed as cumulative call time and are not added.</p>
        {!timeline.segments.length && <p className="dp-stat-note">No step timing has been received for this attempt.</p>}
        {timeline.segments.map((segment, index) => (
          <div key={`${segment.launchId}-${index}`}>
            {index > 0 && (
              <p className="dp-gap" role="note">
                <span className="material-symbols-outlined" aria-hidden="true">more_horiz</span>
                Unknown gap: the app relaunched. Time between launches is not measured, so it is not drawn.
              </p>
            )}
            <SegmentView segment={segment} index={index} />
          </div>
        ))}
        {timeline.unattributedMs !== null && <p className="dp-counts">Time to result not attributed to any step: {formatDuration(timeline.unattributedMs)}.</p>}
        {timeline.notes.map(note => <p key={note} className="dp-counts">{note}</p>)}
      </section>

      {detail.runs.length > 0 && (
        <section className="dp-drawer-section">
          <h3>Processing runs</h3>
          {detail.runs.map((run, index) => <RunView key={run.recordId} run={run} index={index} runs={detail.runs} />)}
        </section>
      )}
      {attempt?.body.preAdmissionFailure && (
        <section className="dp-drawer-section">
          <h3>Stopped before processing started</h3>
          <p><strong>{stageLabel(attempt.body.preAdmissionFailure.stage)}.</strong> {failureExplanation(attempt.body.preAdmissionFailure.failureCode, attempt.body.preAdmissionFailure.failureLayer)}</p>
          <details className="dp-code"><summary>Codes</summary><code>{attempt.body.preAdmissionFailure.stage} · {attempt.body.preAdmissionFailure.failureCode} · {attempt.body.preAdmissionFailure.failureLayer}</code></details>
        </section>
      )}

      <section className="dp-drawer-section">
        <h3>Uploads</h3>
        {!detail.uploadGroups.length ? <p className="dp-muted">No upload has been reported for this attempt.</p> : (
          <div className="dp-table-wrap">
            <table className="dp-table">
              <caption className="admin-sr-only">Upload groups for this attempt</caption>
              <thead><tr><th scope="col">Role</th><th scope="col">State</th><th scope="col">Size</th><th scope="col">Waiting</th><th scope="col">Cloud save</th><th scope="col">Transfers</th><th scope="col">Records write</th></tr></thead>
              <tbody>
                {detail.uploadGroups.map(group => (
                  <tr key={group.recordId}>
                    <th scope="row">{label(UPLOAD_ROLE_LABELS, group.body.category)}</th>
                    <td>{label(SAVE_STATE_LABELS, group.body.jobState)}{group.body.requiredCommitAcknowledged ? " · confirmed" : ""}</td>
                    <td>{formatCount(group.body.uniqueObjectCount)} files · {formatBytes(group.body.uniqueObjectBytes)}</td>
                    <td>{group.body.queueWaitMs !== null ? formatDuration(group.body.queueWaitMs) : missingFor(group, "/queueWaitMs")}{group.body.knownBackoffMs ? <small> + {formatDuration(group.body.knownBackoffMs)} retry waiting</small> : null}</td>
                    <td>{group.body.cloudSaveMs !== null ? formatDuration(group.body.cloudSaveMs) : missingFor(group, "/cloudSaveMs")}</td>
                    <td>{formatCount(group.body.successfulTransferCount)} of {formatCount(group.body.transferAttemptCount)} succeeded{group.body.failedTransferCount ? ` · ${formatCount(group.body.failedTransferCount)} failed` : ""}{group.body.lifetimeRetryCount ? ` · ${formatCount(group.body.lifetimeRetryCount)} retries` : ""}</td>
                    <td>{group.body.firestoreWriteMs !== null ? formatDuration(group.body.firestoreWriteMs) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {attempt?.body.archiveState === "notRequested" && <p className="dp-counts">Video archive: not requested (saving video to the cloud was off). That is not a failed upload.</p>}
        {attempt?.body.archiveState === "unavailable" && <p className="dp-counts">Video archive: unavailable because the clip is no longer on the phone. The results were still saved.</p>}
      </section>

      <section className="dp-drawer-section">
        <h3>Transfers</h3>
        <TransfersTable transfers={detail.transfers} />
        <p className="dp-counts">{formatCount(detail.transfers.length)} of {formatCount(detail.transferPagination.totalRows)} transfers shown. Firestore record writes are timed, never given a speed.</p>
        {/* A stale transfer cursor never recovers by resending it (D-26 A): start again from the first page. */}
        {typeof more === "object" && more.problem === "staleCursor"
          ? <>
            <p className="dp-inline-error" role="alert">The transfer list changed while you were paging. The transfers above may be out of date.</p>
            {onRestart && <button className="quiet-button small" type="button" onClick={onRestart}>Reload transfers from the first page</button>}
          </>
          : <>
            {detail.transferPagination.nextCursor && onLoadMore && (
              <button className="quiet-button small" type="button" disabled={more === "loading"} onClick={onLoadMore}>{more === "loading" ? "Loading…" : "Load more transfers"}</button>
            )}
            {typeof more === "object" && <p className="dp-inline-error" role="alert">{more.title}: {more.message} The transfers above are kept.</p>}
          </>}
      </section>

      <section className="dp-drawer-section">
        <h3>Evidence</h3>
        <p className="dp-muted">Evidence is referenced by its exact id. Nothing here loads a video or a signed Storage link.</p>
        {!detail.evidence.length ? <p className="dp-muted">No diagnostic evidence is recorded for this attempt.</p> : (
          <ul className="dp-evidence">
            {detail.evidence.map(item => (
              <li key={`${item.kind}:${item.id}`}>
                <span className={`admin-chip ${item.availability === "available" ? "accent" : item.availability === "expired" ? "danger" : ""}`}>{EVIDENCE_LABELS[item.availability]}</span>
                <span>{item.kind === "processingAttempt" ? "Processing attempt" : item.kind === "run" ? "Run log" : "Failure case"}</span>
                <code>{item.id}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="dp-code dp-identifiers">
        <summary>Technical identifiers</summary>
        <dl className="dp-fields">
          <Field name="Attempt">{detail.attemptId}</Field>
          {attempt?.repId && <Field name="Rep">{attempt.repId}</Field>}
          {attempt?.commitJobId && <Field name="Commit job">{attempt.commitJobId}</Field>}
          {attempt?.originInstallId && <Field name="Recording install">{attempt.originInstallId}</Field>}
          {attempt?.originLaunchId && <Field name="Recording launch">{attempt.originLaunchId}</Field>}
          {attempt?.stationDeviceId && <Field name="Station device">{attempt.stationDeviceId}</Field>}
          {attempt?.captureFingerprint && <Field name="Capture profile">{attempt.captureFingerprint}</Field>}
          <Field name="First received by the server">{formatDateTime(detail.receivedAt.firstReceivedAtServer, timeZone)}</Field>
          <Field name="Last updated by the server">{formatDateTime(detail.receivedAt.updatedAtServer, timeZone)}</Field>
          {attempt?.missingReasons.length ? <Field name="Missing values">{attempt.missingReasons.map(row => `${row.field || "whole record"}: ${missingReasonLabel(row.reason).toLowerCase()}`).join("; ")}</Field> : null}
        </dl>
      </details>
    </div>
  );
}

function barText(bar: TimelineBar): string {
  const time = bar.durationMs === null ? label(SAVE_STATE_LABELS, bar.status, bar.status).toLowerCase() : formatDuration(bar.durationMs);
  return `${bar.label}: ${bar.status === "notReached" ? "not reached" : bar.status === "interrupted" ? "interrupted" : time}`;
}

function Marker({ bar }: { bar: TimelineBar }) {
  if (bar.marker === "stoppedHere") return <span className="dp-marker dp-marker-stop"><span className="material-symbols-outlined" aria-hidden="true">dangerous</span>Stopped here</span>;
  if (bar.marker === "lastReported") return <span className="dp-marker dp-marker-last"><span className="material-symbols-outlined" aria-hidden="true">help</span>Last reported step</span>;
  return null;
}

function LaneView({ lane, spanMs }: { lane: TimelineLane; spanMs: number }) {
  const scale = spanMs > 0 ? spanMs : 1;
  return (
    <div className={`dp-lane dp-lane-${lane.key}`}>
      <div className="dp-lane-label">{lane.label}</div>
      <div className="dp-lane-track" aria-hidden="true">
        {lane.bars.map((bar, index) => (
          <span key={`${bar.stageId}-${index}`} title={barText(bar)}
            className={`dp-lane-bar${bar.durationMs === null ? " dp-lane-bar-unknown" : ""}${bar.marker ? ` dp-lane-bar-${bar.marker}` : ""}`}
            style={{ left: `${(bar.startMs / scale) * 100}%`, width: bar.durationMs === null ? undefined : `${Math.max(0.4, (bar.durationMs / scale) * 100)}%` }} />
        ))}
      </div>
      <ol className="dp-lane-steps">
        {lane.bars.map((bar, index) => (
          <li key={`${bar.stageId}-${index}`} className={bar.marker ? "dp-lane-step-marked" : undefined}>
            <span>{bar.label}</span>
            <span>{bar.durationMs === null ? bar.status === "notReached" ? "Not reached" : bar.status === "interrupted" ? "Interrupted" : "No timing" : formatDuration(bar.durationMs)}</span>
            <Marker bar={bar} />
          </li>
        ))}
        {!lane.bars.length && !lane.note && <li><span className="dp-muted">No steps reported.</span></li>}
      </ol>
      {lane.nested.length > 0 && (
        <p className="dp-counts">Inside these steps (cumulative call time, not added): {lane.nested.map(bar => `${bar.label} ${bar.durationMs === null ? "no timing" : formatDuration(bar.durationMs)}`).join(", ")}.</p>
      )}
      {lane.note && <p className="dp-counts">{lane.note}</p>}
    </div>
  );
}

function SegmentView({ segment, index }: { segment: TimelineSegment; index: number }) {
  return (
    <div className="dp-segment" role="group" aria-label={`App launch ${index + 1}`}>
      <p className="dp-segment-head">App launch {index + 1}<small>{segment.launchId ? ` · ${segment.launchId.slice(0, 8)}` : ""} · {formatDuration(segment.spanMs)} drawn</small></p>
      {segment.lanes.map((lane, laneIndex) => <LaneView key={`${lane.key}-${laneIndex}`} lane={lane} spanMs={segment.spanMs} />)}
    </div>
  );
}

function RunView({ run, index, runs }: { run: RunSummaryRecordV1; index: number; runs: RunSummaryRecordV1[] }) {
  const body = run.body;
  const retryOf = run.retryOfRunId ? runs.findIndex(other => other.processingRunId === run.retryOfRunId) : -1;
  const peak = body.resources.sampledPeakBytes;
  const thermal = (sample: Record<string, unknown> | null) => (sample && typeof sample.thermalState === "string" ? sample.thermalState : "not reported");
  return (
    <div className="dp-run">
      <p className="dp-run-head">
        <strong>Run {index + 1}</strong>
        <span className={`admin-chip ${body.outcome === "valid" ? "accent" : body.outcome === "failed" ? "danger" : "warn"}`}>{label(OUTCOME_LABELS, body.outcome)}</span>
        {run.retryOfRunId && <span className="admin-chip">{retryOf >= 0 ? `Retry of run ${retryOf + 1}` : "Retry"}</span>}
        {run.processingMode && <span className="admin-chip">{run.processingMode === "recovery" ? "Recovery" : run.processingMode === "liveCapture" ? "Live" : run.processingMode}</span>}
      </p>
      {body.failure && <p><strong>Stopped at {stageLabel(body.failure.stage)}.</strong> {failureExplanation(body.failure.code, body.failure.layer)}</p>}
      {body.outcome === "interruptedUnknown" && <p>The app closed or was suspended before this run finished; its outcome is unknown.</p>}
      <dl className="dp-fields">
        <Field name="Processing time">{formatDuration(body.totals.processingMs)}{body.totals.journalFinalizeMs !== null ? <small> + {formatDuration(body.totals.journalFinalizeMs)} saving the run journal</small> : null}</Field>
        <Field name="Waited for the processor">{formatDuration(body.totals.admissionWaitMs)}</Field>
        <Field name="Frames and model calls">{body.totals.framesDecoded === null ? "Not measured" : formatCount(body.totals.framesDecoded)} frames · {body.totals.modelCalls === null ? "not measured" : formatCount(body.totals.modelCalls)} model calls</Field>
        <Field name="Processed with">{platformText(run.executorPlatform)}{run.executorInstallId && run.executorInstallId !== run.originInstallId ? ` · a different install (${shortInstallId(run.executorInstallId)})` : ""}</Field>
        <Field name="Pose processor">{body.poseDelegateRequested.toUpperCase()} requested · {body.poseDelegateActual ? body.poseDelegateActual.toUpperCase() : "not reported"} used{body.poseDelegateFallbackReason ? ` (fell back: ${body.poseDelegateFallbackReason})` : ""} · object model {body.yoloComputeUnits} · models {body.modelCacheState}</Field>
        <Field name="Memory and heat">{peak === null ? "Peak memory not measured" : `Peak ${formatBytes(peak)}`} · thermal {thermal(body.resources.admitted)} at start, {thermal(body.resources.released)} at end</Field>
      </dl>
      {body.failure && <details className="dp-code"><summary>Codes</summary><code>{body.failure.stage} · {body.failure.code} · {body.failure.layer} · {body.failure.disposition}</code></details>}
    </div>
  );
}

function TransfersTable({ transfers }: { transfers: TransferRecordV1[] }) {
  if (!transfers.length) return <p className="dp-muted">No transfer has been reported for this attempt.</p>;
  return (
    <div className="dp-table-wrap">
      <table className="dp-table">
        <caption className="admin-sr-only">Individual upload transfers</caption>
        <thead><tr><th scope="col">File</th><th scope="col">Size</th><th scope="col">Network</th><th scope="col">Duration</th><th scope="col">Speed</th><th scope="col">Outcome</th></tr></thead>
        <tbody>
          {transfers.map(transfer => {
            const body = transfer.body, speed = transferSpeedMBps(body);
            return (
              <tr key={transfer.recordId}>
                <th scope="row">{body.objectRole.replace(/([A-Z])/g, " $1").toLowerCase()}<small> · commit {body.outerCommitOrdinal}</small></th>
                <td>{formatBytes(body.payloadBytes)}</td>
                <td>{label(NETWORK_LABELS, body.networkInterface)}{body.expensive ? " · metered" : ""}{body.constrained ? " · low data mode" : ""}</td>
                <td>{body.invocationElapsedMs === null ? "Not measured" : formatDuration(body.invocationElapsedMs)}</td>
                <td>{speed === null ? <span className="dp-muted">{body.outcome === "succeeded" ? "No measured duration" : "Not counted"}</span> : formatMBps(speed)}</td>
                <td>{body.outcome === "succeeded" ? "Succeeded" : body.outcome === "failed" ? `Failed${body.normalizedFailureCode ? ` (${body.normalizedFailureCode})` : ""}` : body.outcome}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
