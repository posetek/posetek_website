import { useEffect, useRef, useState } from "react";
import { callRecovery, prepareRecoveryAttempt, recoveryError } from "../lib/account-recovery";
import type { RecoveryAttempt, RecoveryRequestInput } from "../lib/account-recovery";
import "./account-recovery.scss";

export default function AccountRecoveryRequest({ initialEmail = "" }: { initialEmail?: string }) {
  const [form, setForm] = useState<RecoveryRequestInput>(() => ({ email: initialEmail, name: "", organizationName: "", contact: "" }));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [received, setReceived] = useState("");
  const mounted = useRef(false), attempt = useRef<RecoveryAttempt | null>(null), working = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; attempt.current = null; }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (working.current) return;
    working.current = true; setBusy(true); setError("");
    attempt.current = prepareRecoveryAttempt(form, attempt.current);
    const sending = attempt.current;
    try {
      const result = await callRecovery<{ accepted: boolean; requestId: string }>("submitAccountRecoveryRequest", { ...sending.input, requestId: sending.requestId });
      if (!mounted.current) return;
      if (result.accepted !== true || result.requestId !== sending.requestId) throw new Error("Acknowledgement not confirmed");
      setReceived(result.requestId); setForm({ email: "", name: "", organizationName: "", contact: "" }); attempt.current = null;
    } catch (failure) { if (mounted.current) setError(recoveryError(failure)); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  return <details className="account-recovery-request account-recovery" data-clarity-mask="true">
    <summary>Request sign-in help</summary>
    <p>If a reset email did not help, PoseTek or an authorized organization admin can check your account and share a private recovery link after confirming your identity.</p>
    <p>This request does not change a password or confirm an account exists. Keep passwords and access codes out of these fields.</p>
    {received ? <div role="status"><strong>Request received.</strong><p>Keep this reference when contacting PoseTek or your organization admin: <code>{received}</code>.</p><p>No recovery link or email has been sent by this request.</p><button type="button" className="quiet-button" onClick={() => setReceived("")}>Send another request</button></div> : <form onSubmit={event => void submit(event)} aria-busy={busy}>
      <fieldset disabled={busy}><legend className="recovery-sr-only">Sign-in help details</legend>
        <label>Account email<input type="email" name="recovery-account-email" inputMode="email" autoComplete="email" required maxLength={254} spellCheck={false} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
        <label>Your name (optional)<input name="recovery-name" autoComplete="name" maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Organization (optional)<input name="recovery-organization" autoComplete="organization" maxLength={100} value={form.organizationName} onChange={event => setForm({ ...form, organizationName: event.target.value })} /></label>
        <label>How can an admin reach you? (optional)<input name="recovery-contact" autoComplete="off" maxLength={300} value={form.contact} onChange={event => setForm({ ...form, contact: event.target.value })} /></label>
        <p>Your details are unverified claims for authorized support staff to review. They do not give someone access to your account.</p>
        {error && <p role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
        <button type="submit" className="primary-cta">{busy ? "Sending request…" : error ? "Retry help request" : "Request sign-in help"}</button>
      </fieldset>
    </form>}
  </details>;
}
