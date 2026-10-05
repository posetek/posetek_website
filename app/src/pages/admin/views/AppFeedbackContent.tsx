import {
  APP_FEEDBACK_PAGE_SIZE, APP_FEEDBACK_RETENTION_DAYS, EASE_LABELS, FEATURE_LABELS, OBSTRUCTION_LABELS, SOURCE_LABELS,
  feedbackAnswerLabel, feedbackDate, feedbackRate,
} from "../lib/appFeedback";
import type { AppFeedbackCounts, AppFeedbackLoad, AppFeedbackPage, AppFeedbackResponse } from "../lib/appFeedback";

export function AppFeedbackQr({ load, onRetry }: { load: AppFeedbackLoad<string>; onRetry: () => void }) {
  return <figure className="feedback-qr">
    {load.kind === "loading" && <div className="feedback-qr-placeholder" role="status">Creating QR code…</div>}
    {load.kind === "error" && <div className="feedback-error" role="alert"><p>{load.message} You can still copy the QR link.</p><button className="quiet-button" type="button" onClick={onRetry}>Retry QR code</button></div>}
    {load.kind === "ready" && <><img src={load.value} width={220} height={220} alt="QR code for the optional PoseTek app feedback form" />
      <a className="quiet-button" href={load.value} download="posetek-app-feedback-qr.svg">Download QR code</a></>}
    <figcaption>Scan to share your PoseTek experience.</figcaption>
  </figure>;
}

export function AppFeedbackSummary({ load, onRetry }: { load: AppFeedbackLoad<AppFeedbackCounts>; onRetry: () => void }) {
  return <section className="admin-card feedback-summary" aria-labelledby="feedback-summary-heading">
    <h2 id="feedback-summary-heading">Participation · last {APP_FEEDBACK_RETENTION_DAYS} days</h2>
    <p>These counts describe form sessions across all organizations. One person can open more than one session.</p>
    {load.kind === "loading" && <p role="status">Loading participation counts…</p>}
    {load.kind === "error" && <div className="feedback-error" role="alert"><p>{load.message}</p><button type="button" className="quiet-button" onClick={onRetry}>Retry counts</button></div>}
    {load.kind === "ready" && <dl className="feedback-metrics">
      <div><dt>Opened</dt><dd>{load.value.opened.toLocaleString("en-US")}</dd></div>
      <div><dt>Started</dt><dd>{load.value.started.toLocaleString("en-US")}</dd></div>
      <div><dt>Submitted</dt><dd>{load.value.submitted.toLocaleString("en-US")}</dd></div>
      <div><dt>Submitted / opened</dt><dd>{feedbackRate(load.value.submitted, load.value.opened)}</dd></div>
      <div><dt>Submitted / started</dt><dd>{feedbackRate(load.value.submitted, load.value.started)}</dd></div>
    </dl>}
    <p className="feedback-note">Opened means the form appeared. Started means someone interacted with a question or optional comment. Submitted means the response was saved. Counts include sessions with skipped questions.</p>
  </section>;
}

export function AppFeedbackRow({ response }: { response: AppFeedbackResponse }) {
  const date = feedbackDate(response.createdAtMillis);
  return <article className="admin-card feedback-response">
    <header>
      <h3>{feedbackAnswerLabel(FEATURE_LABELS, response.answers.feature)}</h3>
      <p>{response.entrySource === null ? "Source unavailable" : SOURCE_LABELS[response.entrySource]} <span aria-hidden="true">·</span> {date}{date === "Date unavailable" ? "" : " Pacific"}</p>
    </header>
    <dl className="feedback-answers">
      <div><dt>Easy to use</dt><dd>{feedbackAnswerLabel(EASE_LABELS, response.answers.ease)}</dd></div>
      <div><dt>What got in the way</dt><dd>{feedbackAnswerLabel(OBSTRUCTION_LABELS, response.answers.obstruction)}</dd></div>
      {response.durationSeconds !== undefined && <div><dt>Time on form</dt><dd>{Math.round(response.durationSeconds).toLocaleString("en-US")} seconds</dd></div>}
    </dl>
    <div className="feedback-comment"><h4>Comment</h4><p>{response.answers.comment.trim() ? response.answers.comment : "No comment added."}</p></div>
  </article>;
}

export function AppFeedbackResponses({ load, pageNumber, busy, pageError, onRetry, onPrevious, onNext }: {
  load: AppFeedbackLoad<AppFeedbackPage>;
  pageNumber: number;
  busy: boolean;
  pageError: string;
  onRetry: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return <section className="feedback-responses" aria-labelledby="feedback-responses-heading" aria-busy={busy}>
    <div className="feedback-list-heading"><h2 id="feedback-responses-heading">Responses</h2><p>Newest first · up to {APP_FEEDBACK_PAGE_SIZE} per page</p></div>
    {load.kind === "loading" && <div className="admin-card" role="status">Loading responses…</div>}
    {load.kind === "error" && <div className="admin-card feedback-error" role="alert"><p>{load.message}</p><button className="quiet-button" type="button" onClick={onRetry}>Retry responses</button></div>}
    {load.kind === "ready" && <>
      {load.value.responses.length ? <div className="feedback-response-list">{load.value.responses.map(response => <AppFeedbackRow key={response.id} response={response} />)}</div>
        : <div className="admin-card feedback-empty"><h3>No feedback yet</h3><p>Saved responses from the last {APP_FEEDBACK_RETENTION_DAYS} days will appear here.</p></div>}
      {pageError && <p role="alert" className="feedback-error">{pageError} The current page is still shown.</p>}
      <nav className="feedback-pagination" aria-label="Feedback response pages">
        <button className="quiet-button" type="button" disabled={busy || pageNumber === 1} onClick={onPrevious}>Previous</button>
        <span role="status">{busy ? "Loading page…" : `Page ${pageNumber}`}</span>
        <button className="quiet-button" type="button" disabled={busy || !load.value.nextCursor} onClick={onNext}>Next</button>
      </nav>
    </>}
  </section>;
}
