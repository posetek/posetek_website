import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import firebase, { auth } from "../../../lib/firebase";
import { clubCall } from "../../../lib/organization-data";
import { accessLinkText, accessPurposeLabel, accessStatusLabel, refreshAfterIssued } from "../../../lib/access-link-issuer";
import type { AccountAccessLink, IssuedAccessLink } from "../../../lib/access-link-issuer";
import AccessLinkCard from "../../../components/AccessLinkCard";
import "../account-access.scss";

type Mode = "internal_admin_activation" | "account_recovery";
const blankForm = () => ({ email: "", firstName: "", lastName: "", identityConfirmed: false });
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export default function AccountAccess({ preview = false }: { preview?: boolean }) {
  const [mode, setMode] = useState<Mode>("internal_admin_activation");
  const [form, setForm] = useState(blankForm);
  const [links, setLinks] = useState<AccountAccessLink[]>([]);
  const [issued, setIssued] = useState<IssuedAccessLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [revoking, setRevoking] = useState<AccountAccessLink | null>(null);
  const mounted = useRef(false), operationBusy = useRef(false);
  const currentUid = useRef<string | null>(null), epoch = useRef(0), reads = useRef(0);
  const passwordInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    if (preview || !auth.currentUser) return;
    const uid = auth.currentUser.uid, generation = ++reads.current;
    const current = () => mounted.current && reads.current === generation && currentUid.current === uid && auth.currentUser?.uid === uid;
    setLoading(true);
    try {
      const result = await clubCall<{ links: AccountAccessLink[] }>("listAccountAccessLinks", {});
      if (current()) setLinks(result.links);
    } finally { if (current()) setLoading(false); }
  }, [preview]);

  useEffect(() => {
    mounted.current = true;
    document.title = "Account access | PoseTek admin";
    if (preview) return () => { mounted.current = false; };
    const stop = auth.onAuthStateChanged(user => {
      ++epoch.current; ++reads.current;
      currentUid.current = user?.uid ?? null; operationBusy.current = false;
      setIssued(null); setLinks([]); setForm(blankForm()); setPassword(""); setShowPassword(false);
      setRevoking(null); setBusy(false); setError(""); setNotice(""); setNeedsReauth(false);
      if (!user) { setLoading(false); return; }
      void reload().catch(failure => {
        if (mounted.current && currentUid.current === user.uid) setError(errorMessage(failure, "Access links could not be loaded. Refresh to try again."));
      });
    });
    return () => { mounted.current = false; ++epoch.current; ++reads.current; stop(); };
  }, [preview, reload]);
  useEffect(() => { if (needsReauth) passwordInput.current?.focus(); }, [needsReauth]);

  async function perform(action: () => Promise<IssuedAccessLink | null>, success: string) {
    if (preview || operationBusy.current || !auth.currentUser) return;
    const user = auth.currentUser, ticket = ++epoch.current;
    const current = () => mounted.current && epoch.current === ticket && currentUid.current === user.uid && auth.currentUser?.uid === user.uid;
    operationBusy.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const token = await user.getIdTokenResult(true);
      if (!current()) return;
      const recent = typeof token.claims.auth_time === "number" && Date.now() / 1000 - token.claims.auth_time < 285;
      if (!recent) {
        setNeedsReauth(true);
        if (!password || !user.email) throw new Error("Confirm your sign-in with your password below, then try this action again.");
        await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
        if (!current()) return;
        await user.getIdToken(true);
        if (!current()) return;
      }
      setPassword(""); setShowPassword(false); setNeedsReauth(false);
      const result = await action();
      if (!current()) return;
      if (result) {
        const outcome = await refreshAfterIssued(result, { isCurrent: current, retain: setIssued, refresh: reload });
        if (outcome === "stale") return;
        setForm(blankForm());
        if (outcome === "saved-refresh-failed") setError("The link was created, but the list could not refresh. Copy the private link now, then refresh the list.");
      } else {
        setRevoking(null);
        try { await reload(); } catch { if (current()) setError("The link was revoked, but the list could not refresh. Refresh to see its current status."); }
      }
      if (current()) setNotice(success);
    } catch (failure) {
      if (!current()) return;
      setPassword("");
      setError(errorMessage(failure, "This action could not be completed. Refresh the list before trying again."));
    } finally { if (current()) { operationBusy.current = false; setBusy(false); } }
  }
  async function copy(kind: "link" | "code" | "instructions") {
    if (!issued || !auth.currentUser || currentUid.current !== auth.currentUser.uid) return;
    const uid = auth.currentUser.uid;
    try {
      await navigator.clipboard.writeText(accessLinkText(issued, kind));
      if (mounted.current && auth.currentUser?.uid === uid) setNotice(`${kind === "instructions" ? "Sharing instructions" : kind === "link" ? "Private link" : "Access code"} copied.`);
    } catch { if (mounted.current && auth.currentUser?.uid === uid) setError("Clipboard access is unavailable. Select the private code and share it directly with instructions to open posetek.net/join."); }
  }
  const recovery = mode === "account_recovery";
  return <div className="admin-access">
    <section className="admin-heading"><div><p className="eyebrow">PoseTek admin</p><h1>Account access</h1><p>Create private activation and recovery links. Share them directly with the person you have confirmed.</p></div><Link className="quiet-button" to="/admin/organizations">Manage organization staff</Link></section>
    {preview && <p className="form-message" role="status">Read-only preview. Sign in as a PoseTek admin to issue or manage access links.</p>}
    {error && <p className="form-message error" role="alert">{error}</p>}
    {notice && <p className="form-message" role="status">{notice}</p>}
    {issued && <AccessLinkCard link={issued} onCopy={kind => void copy(kind)} onDismiss={() => setIssued(null)} />}
    <section className="admin-card"><div className="admin-access-modes" role="group" aria-label="Access action"><button type="button" className={!recovery ? "quiet-button selected" : "quiet-button"} aria-pressed={!recovery} disabled={busy} onClick={() => { setMode("internal_admin_activation"); setForm(blankForm()); setRevoking(null); setError(""); }}>PoseTek admin activation</button><button type="button" className={recovery ? "quiet-button selected" : "quiet-button"} aria-pressed={recovery} disabled={busy} onClick={() => { setMode("account_recovery"); setForm(blankForm()); setRevoking(null); setError(""); }}>Password recovery</button></div>
      <h2>{recovery ? "Help someone sign in again" : "Activate a PoseTek admin"}</h2>
      <p className="admin-note">{recovery ? "Confirm the person against their existing staff account. Their private link lets them choose a new password; organization access stays the same." : "Use this only for a confirmed PoseTek colleague with an @posetek.net address. This grants access across organizations. Add organization admins and coaches in organization staff management."}</p>
      <form onSubmit={event => { event.preventDefault(); void perform(() => clubCall<IssuedAccessLink>(recovery ? "issueAccountRecovery" : "issueInternalAdminAccess", recovery ? { email: form.email.trim(), identityConfirmed: form.identityConfirmed } : { ...form, email: form.email.trim() }), `${recovery ? "Recovery" : "Activation"} link ready. Share it directly. No email was sent.`); }}>
        <fieldset disabled={busy || preview} className="admin-access-fields"><legend className="admin-sr-only">{recovery ? "Recovery account" : "PoseTek admin identity"}</legend>
          {!recovery && <div className="admin-access-name"><label>First name<input required maxLength={100} autoComplete="off" value={form.firstName} onChange={event => setForm({ ...form, firstName: event.target.value, identityConfirmed: false })} /></label><label>Last name<input required maxLength={100} autoComplete="off" value={form.lastName} onChange={event => setForm({ ...form, lastName: event.target.value, identityConfirmed: false })} /></label></div>}
          <label>{recovery ? "Existing account email" : "PoseTek company email"}<input type="email" name="target-email" required autoComplete="off" spellCheck={false} value={form.email} onChange={event => setForm({ ...form, email: event.target.value, identityConfirmed: false })} /></label>
          <label className="admin-access-confirm"><input type="checkbox" required checked={form.identityConfirmed} onChange={event => setForm({ ...form, identityConfirmed: event.target.checked })} /><span>{recovery ? "I have confirmed this person against the existing account shown above." : "I have confirmed this person and their PoseTek company address."}</span></label>
          <button className="primary-cta" disabled={!form.identityConfirmed}>{busy ? "Creating link…" : recovery ? "Create recovery link" : "Create activation link"}</button>
        </fieldset>
      </form>
    </section>
    {needsReauth && <section className="admin-card admin-access-reauth" aria-labelledby="access-reauth-heading"><h2 id="access-reauth-heading">Confirm your sign-in</h2><p className="admin-note">Enter your own PoseTek password, then try the action again. It confirms you are still the person issuing or revoking access.</p><label>Your password<div className="admin-access-password"><input ref={passwordInput} name="current-password" type={showPassword ? "text" : "password"} autoComplete="current-password" data-clarity-mask="true" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /><button type="button" className="quiet-button" aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide" : "Show"}</button></div></label></section>}
    <section className="admin-card"><div className="admin-access-list-heading"><h2>Recent access links</h2><button className="quiet-button" type="button" disabled={busy || loading || preview} onClick={() => { setError(""); void reload().catch(failure => { if (mounted.current) setError(errorMessage(failure, "Access links could not be loaded.")); }); }}>Refresh</button></div>
      <p className="admin-note">Links are shown without their private codes. To replace a lost link, revoke it and create a new one for the same account.</p>
      {loading && <p role="status">Loading access links…</p>}
      {!loading && <AccountAccessRows links={links} disabled={busy || preview} onRevoke={setRevoking} />}
      {revoking && <div className="admin-access-revoke"><h3>Revoke this link?</h3><p>The {accessPurposeLabel(revoking.purpose).toLowerCase()} link for <strong>{revoking.email}</strong> will stop working. Existing account access stays the same.</p><div className="admin-access-modes"><button type="button" className="primary-cta" disabled={busy || preview} onClick={() => void perform(async () => { await clubCall("revokeAccountAccessLink", { grantId: revoking.grantId }); if (auth.currentUser?.uid === currentUid.current && issued?.grantId === revoking.grantId) setIssued(null); return null; }, "Private link revoked.")}>Revoke private link</button><button type="button" className="quiet-button" disabled={busy} onClick={() => setRevoking(null)}>Cancel</button></div></div>}
    </section>
  </div>;
}

export function AccountAccessRows({ links, disabled, onRevoke }: { links: AccountAccessLink[]; disabled: boolean; onRevoke(link: AccountAccessLink): void }) {
  return <>{!links.length && <p className="admin-empty">No recent access links.</p>}{links.map(link => <div key={link.grantId} className="admin-access-row"><div><strong>{link.email}</strong><span>{accessPurposeLabel(link.purpose)} · {accessStatusLabel(link.status, link.purpose, link.expiresAtMillis)}</span><span>Expires {new Date(link.expiresAtMillis).toLocaleString()}</span></div>{link.status === "pending" && <button type="button" className="quiet-button" disabled={disabled} onClick={() => onRevoke(link)} aria-label={`Revoke ${accessPurposeLabel(link.purpose).toLowerCase()} link for ${link.email}`}>Revoke link</button>}</div>)}</>;
}
