import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { cloud } from "../../../lib/firebase";
import "../user-issues.scss";
type Issue = { id: string; title: string; platform: string; kind: string; code: string; operation: string; severity: string; state: string;
  firstReceivedAtMillis: number; updatedAtMillis: number; occurrences: number; latestBuild: string; latestUser: string; fixRef?: string; verification?: string };
type Occurrence = { id: string; description: string; message: string; occurredAtMillis: number; receivedAtMillis: number; reporterUid: string | null;
  player?: { id: string; name: string }; source: string; sourceReference?: string; build: string; device: string; route: string; delivery: string; hasScreenshot: boolean };
type Cursor = { at: number; id: string } | null;
const date = (value: number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(value);
const states = ["new", "investigating", "fixed", "verified", "dismissed"];
const previewIssue: Issue = { id: "a".repeat(64), title: "Action failed: Save workout", operation: "Save workout", platform: "web", kind: "error", code: "unavailable", severity: "error", state: "new", firstReceivedAtMillis: 1790800000000, updatedAtMillis: 1790800000000, occurrences: 2, latestBuild: "preview", latestUser: "Sample athlete" };
export default function UserIssues({ preview = false }: { preview?: boolean }) {
  const [params, setParams] = useSearchParams(), selected = params.get("issue");
  const currentSelection = useRef(selected);
  useEffect(() => { currentSelection.current = selected; }, [selected]);
  const [refresh, setRefresh] = useState(0);
  const [actor, setActor] = useState("");
  const [actorDraft, setActorDraft] = useState("");
  const loadVersion = useRef(0);
  const [rows, setRows] = useState<Issue[]>([]), [cursor, setCursor] = useState<Cursor>(null), [detail, setDetail] = useState<{ issue: Issue; occurrences: Occurrence[]; truncated?: boolean } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [search, setSearch] = useState(""), [state, setState] = useState(""), [platform, setPlatform] = useState(""), [severity, setSeverity] = useState("");
  const [nextState, setNextState] = useState("new"), [fix, setFix] = useState(""), [verification, setVerification] = useState(""), [image, setImage] = useState("");
  const load = useCallback(async (page: Cursor = null) => {
    const version = ++loadVersion.current;
    setLoading(true); setError("");
    try {
      if (preview) { setRows([previewIssue]); setCursor(null); return; }
      const result = (await cloud.httpsCallable("getUserIssues")({ cursor: page, ...(actor.trim() ? { actorUid: actor.trim() } : {}) })).data as { issues: Issue[]; cursor: Cursor };
      if (version !== loadVersion.current) return;
      setRows(old => page ? [...old, ...result.issues] : result.issues); setCursor(result.cursor);
    } catch { if (version === loadVersion.current) setError("Issues could not be loaded. Please retry."); } finally { if (version === loadVersion.current) setLoading(false); }
  }, [preview, actor]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setDetail(null); setImage(""); if (!selected) return; let active = true;
    const request = preview ? Promise.resolve({ issue: previewIssue, occurrences: [{ id: "b".repeat(64), description: "", message: "Could not save the workout.", occurredAtMillis: previewIssue.updatedAtMillis, receivedAtMillis: previewIssue.updatedAtMillis + 1000, reporterUid: "sample-user", build: "preview", device: "Sample mobile browser", route: "/athlete", source: "client", delivery: "delivered", hasScreenshot: false }] }) : cloud.httpsCallable("getUserIssues")({ issueId: selected }).then(r => r.data);
    void request.then(result => { if (!active) return; setDetail(result); setNextState(result.issue.state); setFix(result.issue.fixRef || ""); setVerification(result.issue.verification || ""); }).catch(() => { if (active) setError("This issue could not be opened. Refresh and try again."); });
    return () => { active = false; };
  }, [selected, preview, refresh]);
  const visible = rows.filter(row => (!state || row.state === state) && (!platform || row.platform === platform) && (!severity || row.severity === severity)
    && [row.title, row.code, row.latestBuild, row.latestUser, row.id].join(" ").toLowerCase().includes(search.toLowerCase()));
  async function save() {
    if (!detail) return; setLoading(true); setError("");
    try {
      if (!preview) await cloud.httpsCallable("updateUserIssue")({ issueId: detail.issue.id, expectedUpdatedAtMillis: detail.issue.updatedAtMillis, state: nextState, fixRef: fix, verification });
      const query = new URLSearchParams(params); query.delete("issue"); setParams(query); setDetail(null); await load();
    } catch (e) { setError((e as Error).message || "The issue could not be updated."); } finally { setLoading(false); }
  }
  return <div className="user-issues-admin">
    <div className="admin-page-heading"><div><p className="admin-eyebrow">USER SUPPORT</p><h1>User issues</h1><p>Crashes, failed actions and reports from your users. Times are Pacific.</p></div><button className="quiet-button" disabled={loading} onClick={() => { setRefresh(v => v + 1); void load(); }}>Refresh</button></div>
    {preview && <p className="admin-note">Illustrative preview. No reports or emails are sent.</p>}
    <form className="issue-account-filter" onSubmit={e => { e.preventDefault(); setActor(actorDraft.trim()); }}><label>Account UID (optional)<input value={actorDraft} onChange={e => setActorDraft(e.target.value)} placeholder="Exact UID from an incident" /></label><button className="quiet-button" type="submit">Filter account</button></form>
    <div className="issue-filters"><label>Find an issue<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Latest user, build, error or reference" /></label>
      <label>Status<select value={state} onChange={e => setState(e.target.value)}><option value="">All statuses</option>{states.map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Platform<select value={platform} onChange={e => setPlatform(e.target.value)}><option value="">All platforms</option>{["web", "ios", "backend"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All severities</option>{["critical", "error", "reported"].map(s => <option key={s}>{s}</option>)}</select></label></div>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <p className="admin-note">{visible.length} matching issues in {rows.length} loaded records. {cursor ? "Load more to search older issues." : ""}</p>
    {!rows.length && <div className="admin-card"><h2>{loading ? "Loading issues…" : "No issues received yet"}</h2><p>Detected failures and submitted reports will appear here. No records does not prove that no failures occurred.</p></div>}
    <div className="issue-list">{visible.map(row => <button key={row.id} className="issue-row" onClick={() => { const q = new URLSearchParams(params); q.set("issue", row.id); setParams(q); }}><span><strong>{row.title}</strong><small>{row.latestUser} · {row.platform} · {row.latestBuild}</small></span><span>{row.state}<small>{row.occurrences} incident{row.occurrences === 1 ? "" : "s"} · {date(row.updatedAtMillis)}</small></span></button>)}</div>
    {cursor && <button className="quiet-button" disabled={loading} onClick={() => void load(cursor)}>Load older issues</button>}
    {selected && <section className="admin-card issue-detail" aria-label="Selected issue"><button className="quiet-button" onClick={() => { const q = new URLSearchParams(params); q.delete("issue"); setParams(q); }}>Close issue</button>
      {!detail ? <p role="status">Loading issue…</p> : <><h2>{detail.issue.title}</h2><p className="issue-reference">Reference: {detail.issue.id}</p>
        <div className="issue-filters"><label>Status<select value={nextState} onChange={e => setNextState(e.target.value)}>{states.map(s => <option key={s}>{s}</option>)}</select></label>
          <label>Fix reference<input value={fix} maxLength={200} onChange={e => setFix(e.target.value)} placeholder="Commit, PR or configuration change" /></label></div>
        <label>Verification evidence<textarea value={verification} maxLength={1000} onChange={e => setVerification(e.target.value)} placeholder="What was retested, on which build, and what happened?" /></label>
        <button className="primary-cta" disabled={loading || ["fixed", "verified"].includes(nextState) && !fix.trim() || nextState === "verified" && !verification.trim()} onClick={() => void save()}>Update status</button>
        <h3>Reported incidents</h3>{detail.truncated && <p>Showing the latest 50 incidents for this issue.</p>}
        {detail.occurrences.map(row => <article className="issue-occurrence" key={row.id}><h4>{row.player?.name || row.reporterUid || "Anonymous user"}</h4><p>Occurred {date(row.occurredAtMillis)} · received {date(row.receivedAtMillis)}</p><p>{row.device} · {row.build} · {row.route}</p><p>{row.description || row.message || "Details are available in the source diagnostic record."}</p><p>Email: {row.delivery === "delivered" ? "Delivered to mail server" : row.delivery}</p>
          {row.sourceReference && <p className="issue-reference">Source: {row.sourceReference}</p>}
          {row.hasScreenshot && <button className="quiet-button" onClick={() => { void cloud.httpsCallable("getUserIssues")({ evidenceId: row.id }).then(r => { if (currentSelection.current === selected) setImage(r.data.screenshot || ""); }).catch(() => { if (currentSelection.current === selected) setError("Screenshot could not be loaded."); }); }}>View screenshot</button>}</article>)}
        {image && <img className="issue-screenshot" src={image} alt="Screenshot attached by the reporter" />}</>}
    </section>}
  </div>;
}
