import { useEffect, useState } from "react";
import { auth } from "../../lib/firebase";
import { drainIssues, issueInput, onIssueQueueChange, queueIssue, reportQueue, redactIssueText } from "../../lib/user-issues";
import "./user-issues.scss";
async function compressImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a PNG or JPEG smaller than 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.6, 0.4, 0.2]) { const image = canvas.toDataURL("image/jpeg", quality); if (image.length <= 230000) return image; }
    throw new Error("This screenshot is too large. Crop it and try again.");
  } finally { bitmap.close(); }
}
export default function ReportProblem() {
  const [text, setText] = useState(""), [image, setImage] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [reports, setReports] = useState<Awaited<ReturnType<typeof reportQueue>>>([]);
  const [fileKey, setFileKey] = useState(0);
  useEffect(() => { let active = true; const load = () => { void reportQueue().then(rows => { if (active) setReports(rows); }).catch(() => {}); }; load(); const off = onIssueQueueChange(load); const authOff = auth.onAuthStateChanged(() => { setReports([]); load(); }); return () => { active = false; off(); authOff(); }; }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await queueIssue({ ...issueInput("user_report", "reported_problem"), kind: "report", description: redactIssueText(text), screenshot: image }); setText(""); setImage(undefined); setFileKey(v => v + 1); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section id="report-problem" className="user-issue-form" aria-labelledby="report-heading">
    <h2 id="report-heading">Report a problem</h2><p>Tell us what happened and what you expected. We include this page, browser and app version to help investigate.</p>
    <form onSubmit={submit}><label htmlFor="issue-description">What went wrong?</label><textarea id="issue-description" value={text} onChange={e => setText(e.target.value)} minLength={5} maxLength={4000} required rows={5} disabled={busy} />
      <label htmlFor="issue-image">Screenshot (optional)</label><input key={fileKey} id="issue-image" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (!file) return; setBusy(true); setImage(undefined); setError(""); void compressImage(file).then(setImage).catch(e => setError(e.message)).finally(() => setBusy(false)); }} />
      <p className="issue-note">Choose an image without passwords or private messages. Screenshots stay in the protected support record.</p>
      {image && <div><img className="issue-screenshot" src={image} alt="Screenshot selected for your report" /><button type="button" onClick={() => { setImage(undefined); setFileKey(v => v + 1); }}>Remove screenshot</button></div>}
      {error && <p role="alert">{error}</p>}<button type="submit" disabled={busy || text.trim().length < 5}>{busy ? "Preparing report…" : "Send report"}</button>
    </form>
    {reports.length > 0 && <div aria-live="polite"><h3>Your recent reports on this device</h3><ul>{reports.sort((a, b) => b.input.occurredAtMillis - a.input.occurredAtMillis).slice(0, 5).map(row => <li key={row.id}>{row.status === "received" ? "Received — thank you." : ["disabled", "rejected"].includes(row.status) ? "Reporting is temporarily unavailable. Please email support." : "Saved on this device — waiting to send."} <small>Reference: {row.reference || row.id}</small></li>)}</ul><button type="button" onClick={() => void drainIssues()}>Retry queued reports</button></div>}
  </section>;
}
