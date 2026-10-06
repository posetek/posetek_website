import { useCallback, useEffect, useRef, useState } from "react";
import {
  feedbackReadError, feedbackShareUrl, normalizeAppFeedbackResponse,
} from "../lib/appFeedback";
import type { AppFeedbackCounts, AppFeedbackCursor, AppFeedbackLoad, AppFeedbackPage, AppFeedbackReview } from "../lib/appFeedback";
import { loadAppFeedback } from "../lib/appFeedbackData";
import { generateFeedbackQrImage } from "../lib/appFeedbackQr";
import { AppFeedbackQr, AppFeedbackResponses, AppFeedbackSummary } from "./AppFeedbackContent";
import "../app-feedback.scss";

const PREVIEW_REVIEW: AppFeedbackReview = {
  responses: [normalizeAppFeedbackResponse("synthetic-feedback", {
    formVersion: 1, entrySource: "qr", answers: { feature: "workouts", ease: "easy", obstruction: "find", comment: "It took me a moment to find the next workout." },
    createdAtMillis: Date.UTC(2026, 9, 3, 17, 0), durationSeconds: 21,
  })], nextCursor: null, metrics: { opened: 24, started: 18, submitted: 12 }, retentionDays: 90,
};

export default function AppFeedback({ preview = false }: { preview?: boolean }) {
  const [load, setLoad] = useState<AppFeedbackLoad<AppFeedbackPage>>(() => preview ? { kind: "ready", value: PREVIEW_REVIEW } : { kind: "loading" });
  const [summary, setSummary] = useState<AppFeedbackLoad<AppFeedbackCounts>>(() => preview ? { kind: "ready", value: PREVIEW_REVIEW.metrics } : { kind: "loading" });
  const [pages, setPages] = useState<AppFeedbackPage[]>(() => preview ? [PREVIEW_REVIEW] : []);
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const [qr, setQr] = useState<AppFeedbackLoad<string>>({ kind: "loading" });
  const requestEpoch = useRef(0);
  const mounted = useRef(false);
  const qrEpoch = useRef(0);

  const createQr = useCallback(async () => {
    const epoch = ++qrEpoch.current;
    try {
      const value = await generateFeedbackQrImage();
      if (mounted.current && epoch === qrEpoch.current) setQr({ kind: "ready", value });
    } catch {
      if (mounted.current && epoch === qrEpoch.current) setQr({ kind: "error", message: "The QR code could not be created." });
    }
  }, []);

  const read = useCallback(async (cursor: AppFeedbackCursor | null, nextIndex: number, reset: boolean) => {
    if (preview) return;
    const epoch = ++requestEpoch.current;
    setBusy(true); setPageError("");
    if (reset) { setLoad({ kind: "loading" }); setSummary({ kind: "loading" }); }
    try {
      const review = await loadAppFeedback(cursor);
      if (!mounted.current || epoch !== requestEpoch.current) return;
      const page = { responses: review.responses, nextCursor: review.nextCursor };
      setPages(current => reset ? [page] : [...current.slice(0, nextIndex), page]);
      setPageIndex(nextIndex); setLoad({ kind: "ready", value: page });
      setSummary({ kind: "ready", value: review.metrics });
    } catch (error) {
      if (!mounted.current || epoch !== requestEpoch.current) return;
      const message = feedbackReadError(error);
      if (reset) { setLoad({ kind: "error", message }); setSummary({ kind: "error", message }); }
      else setPageError(message);
    } finally {
      if (mounted.current && epoch === requestEpoch.current) setBusy(false);
    }
  }, [preview]);

  useEffect(() => {
    mounted.current = true;
    document.title = "App feedback | PoseTek admin";
    if (!preview) void read(null, 0, true);
    void createQr();
    return () => { mounted.current = false; requestEpoch.current += 1; qrEpoch.current += 1; };
  }, [preview, read, createQr]);

  const refresh = () => { void read(null, 0, true); };
  function previous() {
    if (busy || pageIndex === 0) return;
    const index = pageIndex - 1;
    setPageIndex(index); setLoad({ kind: "ready", value: pages[index] }); setPageError("");
  }
  function next() {
    if (busy || load.kind !== "ready" || !load.value.nextCursor) return;
    const index = pageIndex + 1;
    if (pages[index]) { setPageIndex(index); setLoad({ kind: "ready", value: pages[index] }); setPageError(""); }
    else void read(load.value.nextCursor, index, false);
  }
  async function copy(source: "qr" | "message") {
    try {
      await navigator.clipboard.writeText(feedbackShareUrl(source));
      if (mounted.current) setCopyNotice(`${source === "qr" ? "QR" : "Message"} link copied.`);
    } catch {
      if (mounted.current) setCopyNotice("Could not copy automatically. Select the link field and copy it manually.");
    }
  }

  return <div className="app-feedback-admin">
    <section className="admin-heading">
      <div><p className="eyebrow">PoseTek admin</p><h1>App feedback</h1><p>Review voluntary app-experience feedback across PoseTek. Responses are kept for 90 days.</p></div>
      <div className="admin-heading-actions"><button className="quiet-button" type="button" disabled={busy || preview} onClick={refresh}><span className="material-symbols-outlined" aria-hidden="true">refresh</span>Refresh</button></div>
    </section>
    {preview && <p className="feedback-note">Synthetic preview · sample responses and counts.</p>}
    <section className="admin-card feedback-share" aria-labelledby="feedback-share-heading">
      <h2 id="feedback-share-heading">Share the feedback form</h2><p>Show or download the QR code, or copy a link to share in a message. Both links open the same optional form.</p>
      <AppFeedbackQr load={qr} onRetry={() => { setQr({ kind: "loading" }); void createQr(); }} />
      <div className="feedback-share-links">{(["qr", "message"] as const).map(source => <div className="feedback-share-link" key={source}>
        <label htmlFor={`feedback-${source}-link`}>{source === "qr" ? "QR link" : "Message link"}</label>
        <div><input id={`feedback-${source}-link`} readOnly value={feedbackShareUrl(source)} onFocus={event => event.currentTarget.select()} />
          <button className="quiet-button" type="button" onClick={() => void copy(source)} aria-label={`Copy ${source === "qr" ? "QR" : "message"} feedback link`}>Copy</button></div>
      </div>)}</div>
      <p className="feedback-copy-status" role="status">{copyNotice}</p>
    </section>
    <AppFeedbackSummary load={preview ? { kind: "ready", value: PREVIEW_REVIEW.metrics } : summary} onRetry={refresh} />
    <AppFeedbackResponses load={preview ? { kind: "ready", value: PREVIEW_REVIEW } : load} pageNumber={preview ? 1 : pageIndex + 1} busy={!preview && busy} pageError={preview ? "" : pageError} onRetry={refresh} onPrevious={previous} onNext={next} />
  </div>;
}
