import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, KeyboardEvent } from "react";
import { assertJumpPreview, flightFrameProblem, jumpFrameAtTime, jumpFrameTime, jumpPlaybackProblem, jumpPresentedFrameMatches, markerProblem, validJumpSource } from "../lib/jumpRecovery";
import type { JumpPoint, JumpRecoveryInput, JumpRecoveryMethod, JumpRecoveryPreview, JumpReviewContext } from "../lib/jumpRecovery";
import { loadJumpReview, previewJumpRecovery, saveJumpRecovery } from "../lib/jumpRecoveryData";
import AdminModal from "./AdminModal";
import "../jump-review.scss";

type Props = { playerId: string; repId: string; athleteName: string; onSaved: (revisionId: string) => void };
export type JumpReviewServices = {
  load: typeof loadJumpReview;
  preview: typeof previewJumpRecovery;
  save: typeof saveJumpRecovery;
};
const liveServices: JumpReviewServices = { load: loadJumpReview, preview: previewJumpRecovery, save: saveJumpRecovery };
const NO_TIMESTAMPS: number[] = [];
const FLIGHT_LABELS = ["Last grounded", "First airborne", "Last airborne", "First landing contact"];
const BASELINE_LABELS = ["Upright baseline start", "Upright baseline end", "Airborne peak"];
const centimetres = (metres: number | null) => metres === null ? "Not recorded" : `${(metres * 100).toFixed(1)} cm`;

export default function JumpReviewPanel(props: Props) {
  const [state, setState] = useState<{ key: string; context: JumpReviewContext | null; error: string | null } | null>(null);
  const [reload, setReload] = useState(0);
  const key = `${props.playerId}:${props.repId}:${reload}`;
  const context = state?.key === key ? state.context : null;
  const error = state?.key === key ? state.error : null;
  useEffect(() => {
    let live = true;
    loadJumpReview(props.playerId, props.repId).then(context => { if (live) setState({ key, context, error: null }); })
      .catch(error => { if (live) setState({ key, context: null, error: error instanceof Error ? error.message : "The recording could not be checked." }); });
    return () => { live = false; };
  }, [props.playerId, props.repId, key]);
  if (!context) return <section className="admin-card jr-panel"><h2>Review jump</h2>
    {error ? <><p className="form-message" role="alert">{error}</p><button type="button" className="quiet-button" onClick={() => setReload(n => n + 1)}>Retry loading evidence</button></> : <p role="status">Checking the original recording and frame timing…</p>}
  </section>;
  return <JumpReviewEditor key={`${props.repId}:${reload}`} {...props} context={context} onReload={() => setReload(n => n + 1)} />;
}

export function JumpReviewEditor({ playerId, repId, athleteName, context, onSaved, onReload, services = liveServices }: Props & { context: JumpReviewContext; onReload: () => void; services?: JumpReviewServices }) {
  const source = context.source;
  const sourceOrigin = source?.presentationTimeOriginSeconds;
  const usable = validJumpSource(source);
  const timestamps = usable ? source.presentationTimestampsSeconds : NO_TIMESTAMPS;
  const lastFrame = Math.max(0, timestamps.length - 1);
  const video = useRef<HTMLVideoElement | null>(null);
  const requestedFrame = useRef<number | null>(0);
  const presentedMediaTime = useRef<number | null>(null);
  const verificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seeking, setSeeking] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [method, setMethod] = useState<JumpRecoveryMethod>(context.availableMethods.includes("manual_marker") ? "manual_marker" : "flight_time");
  const [corners, setCorners] = useState<JumpPoint[]>([]);
  const [markerFrame, setMarkerFrame] = useState<number | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [cursor, setCursor] = useState({ x: .5, y: .5 });
  const [side, setSide] = useState("");
  const [baseline, setBaseline] = useState<(number | null)[]>([null, null, null]);
  const [flight, setFlight] = useState<(number | null)[]>([null, null, null, null]);
  const [sourceReviewed, setSourceReviewed] = useState(false);
  const [sizeConfirmed, setSizeConfirmed] = useState(false);
  const [contactsVisible, setContactsVisible] = useState(false);
  const [posture, setPosture] = useState(false);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<JumpRecoveryPreview | null>(null);
  const [previewInput, setPreviewInput] = useState<JumpRecoveryInput | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const operationId = useRef<string | null>(null);
  const locked = busy !== null || uncertain;
  function changed(action: () => void) {
    if (locked) return;
    action(); setPreview(null); setPreviewInput(null); setError(null); operationId.current = null;
  }
  const startVerificationTimeout = useCallback(() => {
    if (verificationTimer.current) clearTimeout(verificationTimer.current);
    verificationTimer.current = setTimeout(() => {
      if (requestedFrame.current === null) return;
      setLoaded(false);
      setMediaError("The browser could not verify the displayed frame against the original timestamps. Reload the evidence or use a browser with accurate frame presentation support.");
    }, 5000);
  }, []);
  const settlePresentedFrame = useCallback(() => {
    const requested = requestedFrame.current;
    const displayed = presentedMediaTime.current;
    if (requested === null || displayed === null || video.current?.seeking || !jumpPresentedFrameMatches(timestamps, requested, displayed)) return;
    requestedFrame.current = null;
    if (verificationTimer.current) clearTimeout(verificationTimer.current);
    setFrame(requested); setSeeking(false);
  }, [timestamps]);
  function seek(next: number) {
    const chosen = Math.max(0, Math.min(lastFrame, Math.round(next)));
    const player = video.current;
    if (player) {
      player.pause();
      requestedFrame.current = chosen;
      setSeeking(true);
      if (!player.seeking && presentedMediaTime.current !== null && jumpPresentedFrameMatches(timestamps, chosen, presentedMediaTime.current)) {
        settlePresentedFrame(); return;
      }
      startVerificationTimeout();
      const at = jumpFrameTime(timestamps, chosen);
      const nextAt = chosen < lastFrame ? jumpFrameTime(timestamps, chosen + 1) : at;
      player.currentTime = at + (nextAt - at) / 2;
    }
  }
  useEffect(() => {
    const player = video.current;
    if (!player || !usable || !source) return;
    let handle = 0;
    const initialize = () => {
      const problem = typeof player.requestVideoFrameCallback !== "function" ? "This browser cannot verify displayed video frames. Use a browser with frame presentation support before reviewing measurements." : jumpPlaybackProblem(source, { width: player.videoWidth, height: player.videoHeight, duration: player.duration });
      if (problem) { setLoaded(false); setMediaError(problem); return; }
      setLoaded(true); setMediaError(null);
      // The browser may have painted frame zero before React subscribes. Seek
      // to the next source frame after subscribing, forcing fresh presentation
      // evidence rather than accepting readyState/currentTime as proof.
      requestedFrame.current = 1;
      presentedMediaTime.current = null;
      setSeeking(true); startVerificationTimeout(); player.pause();
      const at = jumpFrameTime(timestamps, 1);
      player.currentTime = at + (timestamps.length > 2 ? (jumpFrameTime(timestamps, 2) - at) / 2 : 0);
    };
    const update = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      presentedMediaTime.current = metadata.mediaTime;
      if (requestedFrame.current !== null) settlePresentedFrame();
      else {
        let displayed = jumpFrameAtTime(timestamps, metadata.mediaTime);
        if (!jumpPresentedFrameMatches(timestamps, displayed, metadata.mediaTime) && jumpPresentedFrameMatches(timestamps, displayed + 1, metadata.mediaTime)) displayed += 1;
        if (jumpPresentedFrameMatches(timestamps, displayed, metadata.mediaTime)) setFrame(displayed);
        else { setLoaded(false); setMediaError("A displayed frame does not match the original timestamps. Review is blocked until playback mapping is verified."); }
      }
      handle = player.requestVideoFrameCallback(update);
    };
    if (typeof player.requestVideoFrameCallback === "function") handle = player.requestVideoFrameCallback(update);
    player.addEventListener("loadedmetadata", initialize);
    if (player.readyState >= 1) initialize();
    return () => { player.removeEventListener("loadedmetadata", initialize); if (handle) player.cancelVideoFrameCallback(handle); if (verificationTimer.current) clearTimeout(verificationTimer.current); };
  }, [usable, source, timestamps, settlePresentedFrame, startVerificationTimeout]);

  function addCorner(point: JumpPoint) {
    if (!selecting || locked || seeking || corners.length >= 4) return;
    changed(() => { setCorners(values => [...values, point]); if (corners.length === 3) setSelecting(false); });
  }
  function stageClick(event: MouseEvent<SVGSVGElement>) {
    if (!selecting) return;
    const rect = event.currentTarget.getBoundingClientRect();
    addCorner({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
  }
  function stageKey(event: KeyboardEvent<SVGSVGElement>) {
    if (!selecting) return;
    const step = event.shiftKey ? .02 : .002;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) event.preventDefault();
    if (event.key === "Enter" || event.key === " ") addCorner(cursor);
    else if (event.key.startsWith("Arrow")) setCursor(p => ({ x: Math.max(0, Math.min(1, p.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))), y: Math.max(0, Math.min(1, p.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0))) }));
  }

  let problem: string | null = null;
  if (!usable) problem = sourceOrigin ? "This recording has a nonzero start timestamp. Its browser frame mapping must be verified before reviewing measurements." : "The original recording and its exact frame timing are required. Recover the phone recording or mark this test for a retest.";
  else if (!context.availableMethods.includes(method)) problem = "This method is not available for the saved evidence.";
  else if (!loaded || mediaError) problem = mediaError || "Wait for the original recording to load.";
  else if (method === "manual_marker") {
    problem = markerProblem(corners);
    if (!problem && (!Number.isFinite(Number(side)) || Number(side) < 3 || Number(side) > 100)) problem = "Enter the measured black-square side length, between 3 and 100 cm.";
    if (!problem && (markerFrame === null || baseline.some(f => f === null || !Number.isInteger(f) || f < 0 || f > lastFrame) || !(baseline[1]! - baseline[0]! >= 4 && baseline[1]! < baseline[2]!) || timestamps[baseline[1]!] - timestamps[baseline[0]!] > 3)) problem = "Mark at least five stable upright baseline frames, within three seconds, followed by the airborne peak.";
    if (!problem && !sizeConfirmed) problem = "Confirm the marker's measured size before calculating.";
  } else {
    problem = flightFrameProblem(flight, lastFrame);
    if (!problem && (!contactsVisible || !posture)) problem = "Confirm clear foot contact and comparable takeoff/landing posture.";
  }
  if (!problem && !sourceReviewed) problem = "Confirm this is the correct player's recording and jump.";

  function input(): JumpRecoveryInput | null {
    if (!source || problem) return null;
    operationId.current ??= crypto.randomUUID();
    const common = { schemaVersion: 1 as const, operationId: operationId.current, method, expectedRevisionId: context.expectedRevisionId, sourceFingerprint: context.sourceFingerprint, source: { path: source.path, generation: source.generation } };
    return method === "manual_marker" ? { ...common, marker: { frame: markerFrame!, corners, sideMetres: Number(side) / 100 }, baseline: { fromFrame: baseline[0]!, toFrame: baseline[1]! }, peakFrame: baseline[2]!, confirmations: { sourceReviewed: true, markerSizeConfirmed: true } }
      : { ...common, takeoff: { lastGroundedFrame: flight[0]!, firstAirborneFrame: flight[1]! }, landing: { lastAirborneFrame: flight[2]!, firstGroundedFrame: flight[3]! }, confirmations: { sourceReviewed: true, contactsVisible: true, comparablePosture: true } };
  }
  async function calculate() {
    const request = input();
    if (!request || busy || seeking) return;
    setBusy("preview"); setError(null); setPreview(null); setPreviewInput(null);
    try {
      const result = await services.preview(playerId, repId, request);
      assertJumpPreview(result, request); setPreview(result); setPreviewInput(request);
    } catch (error) { setError(error instanceof Error ? error.message : "This jump could not be calculated."); }
    finally { setBusy(null); }
  }
  async function save() {
    if (!preview || !previewInput || !note.trim() || busy || uncertain || problem || seeking) return;
    setBusy("save"); setError(null);
    try {
      const result = await services.save(playerId, repId, previewInput, note.trim());
      const fresh = await services.load(playerId, repId);
      if (!result.revisionId || fresh.expectedRevisionId !== result.revisionId || fresh.originalHeight === null || Math.abs(fresh.originalHeight - preview.heightMetres) > 1e-8) throw new Error("The saved result could not be verified. Reload the review before another save.");
      onSaved(result.revisionId);
    } catch (error) {
      setUncertain(true); setConfirming(false);
      setError(`${error instanceof Error ? error.message : "The save could not be verified."} No automatic retry was sent. Reload to check the current revision.`);
    } finally { setBusy(null); }
  }

  function frameFields(labels: string[], values: (number | null)[], setter: (values: (number | null)[]) => void) {
    return <div className="jr-frame-fields">{labels.map((label, index) => <div className="jr-frame-field" key={label}>
      <label><span>{label}</span><input type="number" min={0} max={lastFrame} value={values[index] ?? ""} disabled={locked || !usable} aria-label={`${label} review frame`} onChange={event => changed(() => setter(values.map((v, i) => i === index ? event.target.value === "" ? null : Number(event.target.value) : v)))} /></label>
      <button type="button" className="quiet-button small" disabled={locked || !usable || !loaded || selecting || seeking || playing} onClick={() => changed(() => setter(values.map((v, i) => i === index ? frame : v)))}>Use current</button>
      <button type="button" className="quiet-button small" disabled={values[index] === null || selecting || !usable} onClick={() => seek(values[index]!)} aria-label={`View ${label.toLowerCase()}`}>View</button>
    </div>)}</div>;
  }

  return <section className="admin-card jr-panel" aria-label="Jump recovery review">
    <div className="jr-heading"><div><p className="eyebrow">Recovery</p><h2>Review jump</h2></div><span className="jr-estimate">ESTIMATE ONLY</span></div>
    <p className="admin-note">Recover a missed measurement from the original recording. Saved estimates stay out of verified team rankings.</p>
    {context.blockers.length > 0 && <ul className="jr-blockers">{context.blockers.map(text => <li key={text}>{text}</li>)}</ul>}
    {usable ? <div className="jr-layout">
      <div className="jr-media">
        <div className={`jr-stage${selecting ? " selecting" : ""}`} style={{ aspectRatio: `${source.width} / ${source.height}`, maxWidth: `${620 * source.width / source.height}px` }}>
          <video ref={video} src={source.mediaUrl} preload="auto" playsInline muted onError={() => { setLoaded(false); setMediaError("This browser could not play the original recording. Try a browser that supports its format, or reload the source."); }} onSeeking={() => { if (requestedFrame.current === null && video.current) requestedFrame.current = jumpFrameAtTime(timestamps, video.current.currentTime); setSeeking(true); startVerificationTimeout(); }} onSeeked={settlePresentedFrame} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" onClick={stageClick} onKeyDown={stageKey} tabIndex={selecting ? 0 : -1} role={selecting ? "button" : "img"} aria-label={selecting ? `Select marker corner ${corners.length + 1}. Use arrow keys to move the crosshair, Enter to select.` : "Selected marker outline"}>
            {markerFrame === frame && <>{corners.length > 1 && <polyline points={[...corners, ...(corners.length === 4 ? [corners[0]] : [])].map(p => `${p.x * 1000},${p.y * 1000}`).join(" ")} />}{corners.map((p, i) => <g key={i}><circle cx={p.x * 1000} cy={p.y * 1000} r="6" /><text x={p.x * 1000 + 12} y={p.y * 1000 - 12}>{i + 1}</text></g>)}</>}
            {selecting && <g className="jr-crosshair"><path d={`M ${cursor.x * 1000 - 10} ${cursor.y * 1000} h 20 M ${cursor.x * 1000} ${cursor.y * 1000 - 10} v 20`} /></g>}
          </svg>
        </div>
        <span className="jr-frame-chip">{seeking ? "Verifying displayed frame…" : `Frame ${frame} / ${lastFrame} · ${jumpFrameTime(timestamps, frame).toFixed(4)} s`}</span>
        <div className="jr-playback"><button type="button" className="quiet-button small" onClick={() => seek(frame - 1)} disabled={!loaded || selecting || seeking} aria-label="Previous review frame">← Frame</button><button type="button" className="quiet-button small" disabled={!loaded || selecting || seeking} onClick={() => { const v = video.current; if (v) { if (v.paused) { v.playbackRate = .25; void v.play().catch(() => setMediaError("Playback could not start. Reload the recording.")); } else v.pause(); } }}>{playing ? "Pause" : "Play ¼ speed"}</button><button type="button" className="quiet-button small" onClick={() => seek(frame + 1)} disabled={!loaded || selecting || seeking} aria-label="Next review frame">Frame →</button></div>
        <label className="jr-scrubber"><span className="sr-only">Review video frame</span><input type="range" min={0} max={lastFrame} value={frame} disabled={!loaded || selecting || seeking} onChange={event => seek(Number(event.target.value))} /></label>
        <p className="admin-note">Frame timing comes from this original recording. Playback speed does not change the calculation.</p>
        {mediaError && <button type="button" className="quiet-button" disabled={locked} onClick={onReload}>Reload evidence and discard this draft</button>}
        <details><summary>Recording identity</summary><p className="jr-source">{source.path}<br />Version {source.generation}</p></details>
      </div>
      <div className="jr-controls">
        <label className="admin-field"><span>Recovery method</span><select value={method} disabled={locked || selecting} onChange={event => changed(() => { setMethod(event.target.value as JumpRecoveryMethod); setSelecting(false); })}><option value="manual_marker" disabled={!context.availableMethods.includes("manual_marker")}>Visible marker · torso-rise estimate</option><option value="flight_time" disabled={!context.availableMethods.includes("flight_time")}>No marker · flight-time estimate</option></select></label>
        {method === "manual_marker" ? <>
          <p className="admin-note">Pause on a clear marker. Select the four corners of its black border in order around the square.</p>
          <div className="jr-marker-actions"><button type="button" className="quiet-button" disabled={locked || !loaded || seeking || playing} onClick={() => changed(() => { seek(frame); setMarkerFrame(frame); setCorners([]); setSelecting(true); })}>{corners.length ? "Select marker again" : "Select four corners"}</button>{selecting && <button type="button" className="quiet-button" onClick={() => setSelecting(false)}>Stop selecting</button>}{markerFrame !== null && <button type="button" className="quiet-button" disabled={selecting} onClick={() => seek(markerFrame)}>View marker · {markerFrame}</button>}</div>
          <p role="status" className="admin-note">{selecting ? `Select corner ${corners.length + 1} of 4 on the video. Arrow keys move the crosshair; Enter selects.` : `${corners.length}/4 corners selected.`}</p>
          <label className="admin-field"><span>Measured black-square side (cm)</span><input type="number" min="3" max="100" step="0.01" value={side} disabled={locked} onChange={event => changed(() => { setSide(event.target.value); setSizeConfirmed(false); })} placeholder="Use the actual printed measurement" /></label>
          <label className="jr-check"><input type="checkbox" checked={sizeConfirmed} disabled={locked} onChange={event => changed(() => setSizeConfirmed(event.target.checked))} /><span>I confirmed this marker's printed size.</span></label>
          {frameFields(BASELINE_LABELS, baseline, setBaseline)}
          <p className="admin-note">Use a stable upright baseline before the jump. Perspective and pose tracking still limit this estimate.</p>
        </> : <>
          <p className="admin-note">Bracket takeoff and first landing contact with adjacent frames. Both feet and the ground must be clear.</p>
          {frameFields(FLIGHT_LABELS, flight, setFlight)}
          <label className="jr-check"><input type="checkbox" checked={contactsVisible} disabled={locked} onChange={event => changed(() => setContactsVisible(event.target.checked))} /><span>Both feet and first ground contact are clearly visible.</span></label>
          <label className="jr-check"><input type="checkbox" checked={posture} disabled={locked} onChange={event => changed(() => setPosture(event.target.checked))} /><span>Takeoff and landing posture are comparable, without a tucked landing.</span></label>
          <p className="admin-note">This uses time airborne. It is a different method from torso rise and stays separate from verified comparisons.</p>
        </>}
        <label className="jr-check"><input type="checkbox" checked={sourceReviewed} disabled={locked} onChange={event => changed(() => setSourceReviewed(event.target.checked))} /><span>I reviewed the recording and confirmed the player and jump.</span></label>
        {problem && <p className="admin-note" role="status">{problem}</p>}
        <button type="button" className="primary-cta" disabled={Boolean(problem) || locked || selecting || seeking} onClick={calculate}>{busy === "preview" ? "Calculating…" : "Calculate estimate"}</button>
      </div>
    </div> : <p className="form-message" role="alert">{problem}</p>}
    {preview && <div className="jr-preview" aria-label="Recovered jump preview"><div className="jr-values"><div><span>Saved height</span><strong>{centimetres(context.originalHeight)}</strong></div><div><span>Recovered estimate</span><strong>~{centimetres(preview.heightMetres)}</strong></div><div><span>Selection sensitivity</span><strong>{centimetres(preview.rangeMetres[0])}–{centimetres(preview.rangeMetres[1])}</strong></div></div>
      <p className="admin-note">The range reflects frame or corner selection, not a full accuracy guarantee. Force, power and technique scores are not recovered by this review.</p>
      {preview.warnings.length > 0 && <ul>{preview.warnings.map(text => <li key={text}>{text}</li>)}</ul>}
      <label className="admin-field"><span>Review note</span><textarea value={note} maxLength={2000} disabled={locked} onChange={event => setNote(event.target.value)} placeholder="Describe the visible evidence and any limitations." /></label>
      <button type="button" className="primary-cta" disabled={!note.trim() || locked || Boolean(problem) || seeking} onClick={event => { event.currentTarget.focus({ preventScroll: true }); setConfirming(true); }}>Review estimate before saving</button>
    </div>}
    {error && <p className="form-message" role="alert">{error}</p>}
    {uncertain && <button type="button" className="quiet-button" onClick={onReload}>Reload current revision</button>}
    {confirming && preview && <AdminModal label="Save jump estimate" onClose={() => setConfirming(false)} dismissDisabled={busy === "save"}>
      <h3>Save this estimated jump?</h3><p>{athleteName}: <strong>~{centimetres(preview.heightMetres)}</strong>, using {method === "manual_marker" ? "the reviewed marker and torso rise" : "flight time"}.</p>
      <p>It will be labeled ESTIMATE and excluded from verified rankings. The original record stays in revision history. No message will be sent.</p><blockquote>{note}</blockquote>
      <div className="admin-dialog-actions"><button type="button" className="quiet-button" disabled={busy === "save"} onClick={() => setConfirming(false)}>Keep reviewing</button><button type="button" className="primary-cta" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving estimate…" : "Save estimate"}</button></div>
    </AdminModal>}
  </section>;
}
