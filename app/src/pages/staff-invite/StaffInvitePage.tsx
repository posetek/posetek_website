import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { clubCall, getClubContext } from "../../lib/organization-data";
import { ACCOUNT_ACCESS_PATTERN, accountAccessError, captureStaffAccessLink, completeAccountAccessLink, forgetStaffAccessLink, getAccountAccessLink, initialStaffAccessLink, loadAccountAccess, readStaffAccessLink, STAFF_RECOVERY_HELP } from "../../lib/account-access";
import type { AccountAccessLink, ActiveAccountAccess } from "../../lib/account-access";
import { accountDestination, accountError } from "../landing/account-entry";
import { claimStaffInvitation, staffOrganizationRoute, STAFF_INVITATION_PATTERN } from "./staff-invitation";
import { activateManagedAccount, confirmCurrentAccess, signInForAccessLink } from "./account-activation";
import "../../styles/pose-portal.css";
import "../organization/organization.scss";
import "./staff-invite.scss";

export default function StaffInvitePage() {
  const navigate = useNavigate();
  const [initial] = useState(() => { captureStaffAccessLink(window); return initialStaffAccessLink(); });
  const [user, setUser] = useState(auth.currentUser);
  const [code, setCode] = useState(initial.code);
  const [link, setLink] = useState<AccountAccessLink | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial.present && !initial.code ? "This access link is incomplete. Ask the person who shared it for a new link." : "");
  const [notice, setNotice] = useState("");
  const [attempted, setAttempted] = useState(false);
  const mounted = useRef(false);
  const operation = useRef(0);
  const operationBusy = useRef(false);
  const expectedSignIn = useRef<string | null>(null);
  const previousUid = useRef(auth.currentUser?.uid || null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const setsPassword = Boolean(link && !attempted && link.status === "ready" && (link.accountMode === "new" || link.purpose === "account_recovery"));
  const wrongAccount = Boolean(link && user && user.uid !== link.targetUID);
  const recoveryOnly = Boolean(link && (attempted || link.status !== "ready"));

  useEffect(() => {
    mounted.current = true;
    document.title = "Activate account | PoseTek";
    const stop = auth.onAuthStateChanged(current => {
      const uid = current?.uid || null;
      const expected = expectedSignIn.current !== null && (uid === expectedSignIn.current || (Boolean(current?.email) && expectedSignIn.current === `email:${current!.email!.toLowerCase()}`));
      if (uid !== previousUid.current && !expected) {
        ++operation.current; operationBusy.current = false; setBusy(false); setPassword(""); setConfirm("");
      }
      previousUid.current = uid; setUser(current);
    });
    return () => { mounted.current = false; ++operation.current; operationBusy.current = false; expectedSignIn.current = null; stop(); forgetStaffAccessLink(); };
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (link || legacy) titleRef.current?.focus(); }, [link, legacy]);
  useEffect(() => {
    if (initial.code) void checkCode(initial.code);
    const capture = () => {
      if (!readStaffAccessLink(window.location.href).invitation.present) return;
      captureStaffAccessLink(window);
      const next = initialStaffAccessLink();
      ++operation.current; operationBusy.current = false; setBusy(false);
      setCode(next.code); setLink(null); setLegacy(false); setAttempted(false); setPassword(""); setConfirm(""); setError("");
      if (next.code) void checkCode(next.code);
      else setError("This access link is incomplete. Ask the person who shared it for a new link.");
    };
    window.addEventListener("hashchange", capture); window.addEventListener("popstate", capture);
    return () => { window.removeEventListener("hashchange", capture); window.removeEventListener("popstate", capture); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function begin() {
    const revision = ++operation.current;
    operationBusy.current = true; setBusy(true); setError(""); setNotice("");
    return () => mounted.current && operation.current === revision;
  }
  function finish(isCurrent: () => boolean) {
    if (isCurrent()) { operationBusy.current = false; expectedSignIn.current = null; setBusy(false); }
  }
  async function checkCode(value = code) {
    if (operationBusy.current) return;
    const normalized = value.trim().toUpperCase();
    if (STAFF_INVITATION_PATTERN.test(normalized)) {
      setCode(normalized); setLegacy(true); setLink(null); setError(""); setNotice(""); setPassword(""); return;
    }
    if (!ACCOUNT_ACCESS_PATTERN.test(normalized)) { setError("Paste the full access code shared by your administrator."); return; }
    const isCurrent = begin();
    try {
      const result = await getAccountAccessLink(normalized);
      if (!isCurrent()) return;
      setCode(normalized); setLink(result); setEmail(result.email); setLegacy(false); setAttempted(false); setPassword(""); setConfirm("");
      forgetStaffAccessLink();
    } catch (failure) { if (isCurrent()) setError(accountAccessError(failure)); }
    finally { finish(isCurrent); }
  }
  function open(access: ActiveAccountAccess) {
    setCode(""); forgetStaffAccessLink();
    const destination = accountDestination(access.role, access.playerId || null, "", window.location.href, window.location.origin);
    navigate(access.organizationId && (access.role === "coach" || access.role === "manager") ? staffOrganizationRoute(access.organizationId) : destination, { replace: true });
  }
  async function submit() {
    if (operationBusy.current || wrongAccount) return;
    if (setsPassword && (password.length < 8 || password !== confirm)) { setError(password.length < 8 ? "Choose a password with at least 8 characters." : "Passwords do not match."); return; }
    const isCurrent = begin();
    try {
      if (legacy) {
        let current = auth.currentUser;
        if (!current) {
          expectedSignIn.current = `email:${email.trim().toLowerCase()}`;
          const credential = await auth.signInWithEmailAndPassword(email.trim(), password);
          current = credential.user;
          if (!isCurrent()) return;
        }
        if (!current) throw new Error("Sign in with the account your administrator invited.");
        const uid = current.uid;
        const currentClaim = () => isCurrent() && auth.currentUser?.uid === uid;
        await current.reload(); if (!currentClaim()) return;
        if (!current.emailVerified) throw new Error("This older invitation requires a verified account. Ask your administrator to replace it with an access link; no verification email is sent here.");
        const result = await claimStaffInvitation(code, { isCurrent: currentClaim, refreshVerified: async () => { const token = await current!.getIdTokenResult(true); return token.claims.email_verified === true; }, redeem: value => clubCall("redeemClubStaffInvitation", { code: value }), context: getClubContext });
        if (!currentClaim()) return;
        if (result.kind === "claimed") { setCode(""); navigate(staffOrganizationRoute(result.organization.id), { replace: true }); }
        else setError(result.message + " Sign in to open your current organization.");
        return;
      }
      if (!link) return;
      expectedSignIn.current = link.targetUID;
      const deps = {
        isCurrent,
        currentUser: () => auth.currentUser,
        complete: completeAccountAccessLink,
        signIn: async (address: string, secret: string) => {
          const credential = await auth.signInWithEmailAndPassword(address, secret);
          if (!credential.user) throw new Error("Sign-in could not be confirmed.");
          return credential.user;
        },
        access: (current: NonNullable<typeof auth.currentUser>) => loadAccountAccess(current, () => isCurrent() && auth.currentUser?.uid === current.uid),
      };
      if (recoveryOnly) {
        const access = auth.currentUser?.uid === link.targetUID ? await confirmCurrentAccess(link, code, deps) : await signInForAccessLink(link, code, password, deps);
        if (isCurrent()) open(access);
      } else {
        if (!setsPassword && !auth.currentUser) {
          await deps.signIn(link.email, password);
          if (!isCurrent()) return;
        }
        if (setsPassword) setAttempted(true);
        const result = await activateManagedAccount(link, code, setsPassword ? password : undefined, deps);
        if (isCurrent()) open(result.access);
      }
    } catch (failure) {
      if (isCurrent()) {
        const known = failure instanceof Error && !("code" in failure) ? failure.message : accountError(failure, accountAccessError(failure));
        setError(known);
        if (setsPassword) {
          setNotice("If your password was saved, sign in with it below. Your access link will not change it again.");
          try {
            const latest = await getAccountAccessLink(code);
            if (isCurrent() && latest.targetUID === link?.targetUID && latest.purpose === link.purpose) setLink(latest);
          } catch { /* Preserve sign-in recovery without guessing whether a write succeeded. */ }
        }
      }
    } finally { if (isCurrent()) { setPassword(""); setConfirm(""); } finish(isCurrent); }
  }
  async function switchAccount() {
    if (operationBusy.current) return;
    const isCurrent = begin();
    try { await auth.signOut(); }
    catch { if (isCurrent()) setError("Could not sign out. Please try again."); }
    finally { finish(isCurrent); }
  }
  function changeCode() {
    ++operation.current; operationBusy.current = false; setBusy(false); setLink(null); setLegacy(false); setAttempted(false); setCode(""); setPassword(""); setConfirm(""); setError(""); setNotice(""); forgetStaffAccessLink();
  }
  const title = !link && !legacy ? "Activate your account" : setsPassword ? link?.purpose === "account_recovery" ? "Choose a new password" : "Choose your password" : recoveryOnly ? "Open your account" : "Activate your access";
  return <div className="pt-pose portal-body pt-club staff-activation" data-clarity-mask="true">
    <header className="portal-header"><Link className="portal-brand" to="/signin"><span className="portal-brand-mark">P</span>POSETEK</Link><Link className="club-inline-link" to="/signin">Sign in</Link></header>
    <main className="club-shell club-signup">
      <p className="eyebrow">Coaches &amp; administrators</p><h1 ref={titleRef} tabIndex={-1}>{title}</h1>
      <p>{!link && !legacy ? "Open the access link your administrator shared, or paste your code below." : setsPassword ? "Use this password whenever you sign in to PoseTek." : "Use your existing PoseTek account to continue."}</p>
      {error && <p className="club-message error" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      {notice && <p className="club-message" role="status">{notice}</p>}
      {!link && !legacy ? <section className="club-card" aria-label="Access code"><form onSubmit={event => { event.preventDefault(); void checkCode(); }} aria-busy={busy}>
        <label>Access code<input name="access-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} required maxLength={100} disabled={busy} value={code} onChange={event => setCode(event.target.value)} placeholder="ACCESS-…" aria-describedby="access-code-help" /></label>
        <p className="activation-help" id="access-code-help">Your administrator shares this directly. Keep the link handy if you leave this page.</p>
        <button className="primary-cta" disabled={busy}>{busy ? "Checking access…" : "Check access code"}</button>
      </form></section> : <section className="club-card" aria-label="Account activation" aria-busy={busy}>
        {link && <div className="activation-account"><span>{[link.firstName, link.lastName].filter(Boolean).join(" ") || "Your account"}</span><strong>{link.email}</strong><span>{link.purpose === "account_recovery" ? "Account recovery" : link.role === "admin" ? "PoseTek administrator" : link.role === "manager" ? "Organization administrator" : "Coach"}</span>{link.organizationName && <span>{link.organizationName}</span>}{link.role === "manager" && <span>Access to every team in your organization</span>}{link.role === "coach" && link.teamNames?.length ? <span>Teams: {link.teamNames.join(", ")}</span> : null}</div>}
        {legacy && <p className="activation-help">This older invitation works with an existing verified account. If you are new to PoseTek, ask your administrator for a new access link.</p>}
        {wrongAccount ? <><p>Signed in as <strong>{user?.email}</strong>. This link belongs to <strong>{link?.email}</strong>.</p><button className="primary-cta" disabled={busy} onClick={() => { void switchAccount(); }}>Use another account</button></> : <form onSubmit={event => { event.preventDefault(); void submit(); }}>
          {recoveryOnly && <p className="activation-help">{link?.status === "processing" ? "An access change is still being checked. Try signing in with your password. If you cannot continue, ask PoseTek to check the link." : "Sign in to check your current access. This step keeps your saved password."}</p>}
          {legacy && !user && <label>Invited email<input name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /></label>}
          {(setsPassword || !user) && <>
            {link && <input className="activation-username" name="email" type="email" autoComplete="username" value={link.email} readOnly tabIndex={-1} aria-hidden="true" />}
            <label>{setsPassword ? "Your password" : "Password"}<input name="password" type={showPassword ? "text" : "password"} required minLength={setsPassword ? 8 : undefined} maxLength={setsPassword ? 128 : undefined} autoComplete={setsPassword ? "new-password" : "current-password"} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
            {setsPassword && <><p className="activation-help">At least 8 characters. Choose a password only you know.</p><label>Confirm password<input name="confirm-password" type={showPassword ? "text" : "password"} required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy} value={confirm} onChange={event => setConfirm(event.target.value)} /></label></>}
            <button type="button" className="activation-password-toggle" aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Hide password" : "Show password"}</button>
          </>}
          {user && !setsPassword && <p className="activation-help">Signed in as <strong>{user.email}</strong>.</p>}
          <button className="primary-cta" disabled={busy}>{busy ? "Checking your account…" : recoveryOnly ? user ? "Check account access" : "Sign in" : setsPassword ? link?.purpose === "account_recovery" ? "Save password and sign in" : "Activate account" : user ? "Activate access" : "Sign in and activate"}</button>
          {user && <button type="button" className="quiet-button" disabled={busy} onClick={() => { void switchAccount(); }}>Use another account</button>}
        </form>}
        <button className="activation-change-code" type="button" disabled={busy} onClick={changeCode}>Use a different code</button>
      </section>}
      <details className="activation-assistance"><summary>Need help with your account?</summary><p>{STAFF_RECOVERY_HELP}</p><p>Account activation and assisted recovery do not send email. If an older invitation requires email verification, ask for a replacement access link.</p></details>
      <p className="activation-footer">Already activated? <Link className="club-inline-link" to="/signin">Sign in to PoseTek</Link>. Joining as a player? <Link className="club-inline-link" to="/signin">Use your player signup code</Link>.</p>
    </main>
  </div>;
}
